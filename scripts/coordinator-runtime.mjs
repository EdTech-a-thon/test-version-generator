// Process, repository and ownership primitives used by the ticket coordinator.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const activeCommands = new Set();
export function stopCommands() {
  for (const stop of activeCommands) stop('SIGKILL');
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

export function runCommand(command, { cwd, env = {}, timeoutMs = 600_000, input, onOutput } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = Array.isArray(command) ? command : ['bash', '-lc', command];
    const child = spawn(argv[0], argv.slice(1), {
      cwd, env: { ...process.env, ...env }, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false, finished = false;
    let killTimer;
    const kill = (signal) => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
    };
    activeCommands.add(kill);
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      // The leader can exit while background descendants (with closed pipes)
      // remain alive. Always finish the owned process group before resolving.
      kill('SIGKILL');
      activeCommands.delete(kill);
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (error) stderr += error.message;
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr, combined: stdout + stderr,
        timedOut, durationMs: Date.now() - started });
    };
    // Keep a bounded tail in memory; complete output goes to the caller's log.
    const capture = (stream, chunk) => {
      onOutput?.(chunk.toString());
      if (stream === 'out') stdout = (stdout + chunk).slice(-2_000_000);
      else stderr = (stderr + chunk).slice(-2_000_000);
    };
    child.stdout.on('data', chunk => capture('out', chunk));
    child.stderr.on('data', chunk => capture('err', chunk));
    child.once('error', error => finish(1, error));
    child.once('close', code => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
    }, timeoutMs);
  });
}

export async function checked(run, command, options) {
  const result = await run(command, options);
  if (result.code !== 0) throw new Error(`${JSON.stringify(command)} failed: ${result.combined}`);
  return result.stdout.trim();
}

// An alternate index includes tracked and untracked content without staging in
// the caller's index. Git tree IDs include filenames, modes, deletes and bytes.
export async function snapshot(run, cwd, directory, base) {
  fs.mkdirSync(directory, { recursive: true });
  const index = path.join(directory, `index-${crypto.randomUUID()}`);
  const opts = { cwd, env: { GIT_INDEX_FILE: index } };
  try {
    await checked(run, ['git', 'read-tree', 'HEAD'], opts);
    await checked(run, ['git', 'add', '-A', '--', '.'], opts);
    const tree = await checked(run, ['git', 'write-tree'], opts);
    const filesResult = await run(['git', 'diff', '--name-only', '-z', base, tree], { cwd });
    if (filesResult.code) throw new Error(filesResult.combined);
    const files = filesResult.stdout.split('\0').filter(Boolean);
    return { tree, files };
  } finally {
    fs.rmSync(index, { force: true });
    fs.rmSync(`${index}.lock`, { force: true });
  }
}

export function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'run.lock');
  const token = crypto.randomUUID();
  // No automatic stale-lock deletion: another contender could replace a stale
  // file between inspection and unlink. Recovery explicitly verifies ownership.
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Coordinator lock exists: ${file}. Inspect its PID and any surviving workers before removing this lock.`);
    throw error;
  }
  return () => {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file); } catch { /* preserve another owner's lock */ }
  };
}

export function selectChecks(config, files, full = false) {
  // Legacy verify remains a conservative fallback for imported configurations.
  if (!config.verification) return config.verify || [];
  const v = config.verification;
  const commands = [...v.quick];
  if (full) commands.push(...v.full);
  else {
    const rules = v.affected || [];
    const matches = rules.filter(rule => files.some(file => new RegExp(rule.match).test(file)));
    const browserFiles = v.browserCommand ? files.filter(file => /^scripts\/[^/]+\.e2e\.ts$/.test(file)) : [];
    const unknown = files.some(file => !browserFiles.includes(file) && !rules.some(rule => new RegExp(rule.match).test(file)));
    if (unknown || matches.some(rule => rule.full)) commands.push(...v.full);
    else {
      for (const rule of matches) commands.push(...(rule.commands || []));
      if (browserFiles.length) commands.push([...v.browserCommand, ...browserFiles]);
    }
  }
  for (const rule of v.required || []) {
    if (files.some(file => new RegExp(rule.match).test(file))) commands.push(...rule.commands);
  }
  return [...new Map(commands.map(command => [JSON.stringify(command), command])).values()];
}

export function failureKind(result) {
  if (result.timedOut || /Page crashed|Target crashed|ENOMEM|ENOSPC|ECONNRESET|EAI_AGAIN|ERR_CONNECTION_REFUSED/i.test(result.combined)) return 'environment';
  return 'verification';
}
