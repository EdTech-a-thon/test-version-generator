#!/usr/bin/env node
// Simple Agent Coordinator. Node built-ins only. See spec in repo history.
// Implements a queue of GitHub tickets: implement -> verify -> review -> accept.
// The script (not an LLM) owns waiting, state, verification, commits, progression.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import process from 'node:process';

// ---------- small utilities ----------

const nowRunId = () => new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');

function sha(s) { return crypto.createHash('sha256').update(s || '').digest('hex'); }

function truncate(s, max = 8000) {
  if (!s) return '';
  if (s.length <= max) return s;
  const head = s.slice(0, max * 0.6 | 0);
  const tail = s.slice(-(max * 0.3 | 0));
  return `${head}\n\n...[truncated ${s.length - head.length - tail.length} chars; full log on disk]...\n\n${tail}`;
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, obj) { writeAtomic(file, JSON.stringify(obj, null, 2)); }

// ---------- default dependencies (injectable for tests) ----------

function defaultRun(cmd, opts = {}) {
  const r = spawnSync('bash', ['-lc', cmd], {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  return { code: r.status == null ? 1 : r.status, stdout, stderr, combined: stdout + stderr };
}

function makeDefaultDeps() {
  return {
    run: defaultRun,
    spawn,
    log: (line) => process.stdout.write(line + '\n'),
    now: nowRunId,
  };
}

// ---------- Pi RPC session ----------
// Owns a `pi --mode rpc` child process directly. The coordinator awaits
// agent_settled; it never hands control to another model while waiting.

class PiSession {
  constructor(deps, { agentCfg, sessionDir, rpcLogPath, name, skillPaths }) {
    this.deps = deps;
    this.agentCfg = agentCfg;
    this.sessionDir = sessionDir;
    this.rpcLogPath = rpcLogPath;
    this.name = name;
    this.skillPaths = skillPaths || [];
    this.child = null;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.handlers = new Set();
    this.lastAssistantText = null;
    this.exited = false;
    this.exitCode = null;
  }

  start() {
    mkdirp(this.sessionDir);
    const args = [
      '--mode', 'rpc',
      '--session-dir', this.sessionDir,
      '--provider', this.agentCfg.provider,
      '--model', this.agentCfg.model,
      '--thinking', this.agentCfg.thinking || 'high',
      '-n', this.name || 'coordinator',
    ];
    for (const sp of this.skillPaths) { args.push('--skill', sp); }
    this.child = this.deps.spawn('pi', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rpcLog = fs.createWriteStream(this.rpcLogPath, { flags: 'a' });
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
    this.child.stderr.on('data', (chunk) => this.rpcLog.write(`STDERR ${chunk}`));
    this.child.on('exit', (code) => { this.exited = true; this.exitCode = code; });
  }

  _onData(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) break;
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) continue;
      this.rpcLog.write(line + '\n');
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      this._onEvent(ev);
    }
  }

  _onEvent(ev) {
    if (ev.type === 'message_end' && ev.message && ev.message.role === 'assistant') {
      const text = (ev.message.content || [])
        .filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text) this.lastAssistantText = text;
    }
    for (const h of this.handlers) h(ev);
  }

  _send(obj) {
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  // Send a prompt and resolve when the run settles (or the process dies first).
  prompt(message) {
    return new Promise((resolve) => {
      let settled = false;
      const onEvent = (ev) => {
        if (ev.type === 'agent_settled') {
          settled = true;
          this.handlers.delete(onEvent);
          this.child.removeListener('exit', onExit);
          resolve({ settled: true, lastAssistantText: this.lastAssistantText });
        }
      };
      const onExit = () => {
        if (settled) return;
        this.handlers.delete(onEvent);
        resolve({ settled: false, lastAssistantText: this.lastAssistantText });
      };
      this.handlers.add(onEvent);
      this.child.once('exit', onExit);
      this._send({ type: 'prompt', message });
    });
  }

  stop() {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    try { this.rpcLog.end(); } catch { /* ignore */ }
  }
}

// ---------- prompt generation (pure, testable) ----------
//
// We do NOT hand-write the implementation/review methodology. The substance
// comes from Matt Pocock's `implement` and `code-review` skills, invoked as
// slash commands (`/skill:implement`, `/skill:code-review`). Everything below
// is only the thin "coordinator contract" that reconciles those skills with the
// fact that THIS script — not the agent — owns verification, review dispatch,
// commits, and ticket progression.

export function buildImplementationPrompt({ number, issueFile }) {
  return [
    // Invoke the real skill. It carries the implementation methodology (TDD at
    // agreed seams, typecheck/test cadence, etc.).
    `/skill:implement`,
    ``,
    `Work item: GitHub ticket #${number}. The full issue text (title, body,`,
    `comments) is saved at: ${issueFile}. Read AGENTS.md and CONTEXT.md too.`,
    ``,
    `Coordinator contract (this overrides the skill's final housekeeping steps,`,
    `because an outer script owns them — do not fight it):`,
    `- Implement ONLY ticket #${number}; nothing unrelated.`,
    `- Do NOT commit, push, close issues, run /code-review yourself, or start`,
    `  subagents. The coordinator runs verification, the review, and the commit`,
    `  for you after you settle.`,
    `- If an existing acceptance test genuinely conflicts with the spec, write`,
    `  .coordinator/test-change-request.json describing the conflict, then stop.`,
    `- Stop when the ticket is settled or you are blocked.`,
  ].join('\n');
}

export function buildRepairFromVerify({ command, output }) {
  return [
    `A required verification command the coordinator ran FAILED. Continue the`,
    `same /skill:implement work: fix the underlying problem, then stop. Do not`,
    `commit or review.`,
    ``,
    `Command: ${command}`,
    ``,
    `Output (truncated; full log on disk):`,
    '```',
    truncate(output, 6000),
    '```',
  ].join('\n');
}

export function buildRepairFromReview({ report }) {
  return [
    `The /skill:code-review reviewer returned BLOCKING findings. Continue the`,
    `same /skill:implement work: address every blocking finding below, then`,
    `stop. Do not commit or review yourself.`,
    ``,
    `--- reviewer report ---`,
    truncate(report, 6000),
  ].join('\n');
}

export function buildReviewPrompt({ number, issueFile, baseCommit }) {
  return [
    // Invoke the real two-axis review skill against this ticket's diff.
    `/skill:code-review`,
    ``,
    `Fixed point for the review: ${baseCommit} (review ${baseCommit}...HEAD, i.e.`,
    `all changes for this ticket). The originating spec is GitHub ticket`,
    `#${number}; its full text is saved at: ${issueFile} (use that as the spec`,
    `source rather than re-fetching).`,
    ``,
    `Coordinator contract:`,
    `- You are a FRESH reviewer. Inspect the repository read-only; do NOT edit`,
    `  any file.`,
    `- Run the skill's two axes and produce its Standards/Spec report as usual.`,
    `- THEN decide a single blocking verdict for the coordinator. Treat as`,
    `  blockers only: unmet acceptance criteria, incorrect behavior/regressions,`,
    `  missing coverage for risky behavior, tests weakened just to pass, or`,
    `  material maintainability defects. Style/optional items are NOT blockers.`,
    `- Your VERY LAST line must be exactly one JSON object and nothing after it:`,
    `  {"verdict":"accept","findings":[]}`,
    `  or`,
    `  {"verdict":"reject","findings":[{"title":"...","evidence":"...","requiredChange":"..."}]}`,
    `  The JSON must reflect the report above; the report is the human-readable`,
    `  detail, the JSON is the machine gate.`,
  ].join('\n');
}

// ---------- review parsing ----------

export function parseReviewVerdict(text) {
  if (!text) return { ok: false, reason: 'empty review response' };
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  // fall back to the last {...} block
  if (!raw.startsWith('{')) {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1) return { ok: false, reason: 'no JSON object found' };
    raw = raw.slice(first, last + 1);
  }
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'invalid JSON: ' + e.message }; }
  if (obj.verdict !== 'accept' && obj.verdict !== 'reject') {
    return { ok: false, reason: 'unknown verdict: ' + JSON.stringify(obj.verdict) };
  }
  const findings = Array.isArray(obj.findings) ? obj.findings : [];
  return { ok: true, verdict: obj.verdict, findings };
}

// ---------- coordinator ----------

export class Coordinator {
  constructor({ deps, config, options, root }) {
    this.deps = deps;
    this.config = config;
    this.options = options;
    this.root = root;
    this.coordDir = path.join(root, '.coordinator');
    this.runsDir = path.join(this.coordDir, 'runs');
    this.pointerFile = path.join(this.coordDir, 'current-run.json');
  }

  // Resolve configured skill dirs to absolute paths passed to `pi --skill`.
  // `which` is 'implement' or 'review'; `extra` skills load into both sessions.
  skillPathsFor(which) {
    const s = this.config.skills || {};
    const out = [];
    const add = (rel) => { if (rel) out.push(path.isAbsolute(rel) ? rel : path.join(this.root, rel)); };
    add(s[which]);
    for (const e of s.extra || []) add(e);
    return out;
  }

  git(cmd) { return this.deps.run(`git ${cmd}`, { cwd: this.root }); }
  gh(cmd) { return this.deps.run(`gh ${cmd}`, { cwd: this.root }); }

  trackedDiffHash() {
    return sha(this.git('diff HEAD').stdout);
  }

  saveState() { writeJsonAtomic(path.join(this.runDir, 'state.json'), this.state); }

  transition(newState) {
    this.state.state = newState;
    this.saveState();
  }

  ticketDir(n) { return path.join(this.runDir, 'tickets', String(n)); }

  // ----- preconditions -----
  checkPreconditions(tickets) {
    const problems = [];
    for (const tool of ['git', 'gh', 'node', 'pi']) {
      if (this.deps.run(`command -v ${tool}`).code !== 0) problems.push(`missing tool: ${tool}`);
    }
    const branch = this.git('rev-parse --abbrev-ref HEAD').stdout.trim();
    const want = this.config.branch || 'dev';
    if (branch !== want) problems.push(`current branch is '${branch}', must be '${want}'`);
    const status = this.git('status --porcelain').stdout
      .split('\n').filter((l) => l && !l.startsWith('??'));
    if (status.length) problems.push(`tracked files are modified:\n${status.join('\n')}`);
    if (this.gh('auth status').code !== 0) problems.push('GitHub authentication failed');
    for (const t of tickets) {
      const r = this.gh(`issue view ${t} --json number,state,title`);
      if (r.code !== 0) { problems.push(`issue #${t} not found`); continue; }
      let j; try { j = JSON.parse(r.stdout); } catch { problems.push(`issue #${t} unreadable`); continue; }
      if (String(j.state).toUpperCase() !== 'OPEN') problems.push(`issue #${t} is not open (${j.state})`);
    }
    // .coordinator must be ignored
    if (this.git('check-ignore .coordinator').code !== 0) {
      problems.push('.coordinator/ is not gitignored');
    }
    return problems;
  }

  // ----- run lifecycle -----
  startRun(tickets) {
    const runId = this.deps.now();
    this.runDir = path.join(this.runsDir, runId);
    mkdirp(this.runDir);
    const baseCommit = this.git('rev-parse HEAD').stdout.trim().slice(0, 7);
    this.state = {
      runId, tickets, currentTicket: tickets[0], state: 'queued',
      baseCommit, implementationSession: null, repairCycles: 0,
      push: !!this.options.push, accepted: [], blocked: null,
    };
    mkdirp(this.runsDir);
    writeJsonAtomic(this.pointerFile, { runId });
    this.saveState();
  }

  loadRun() {
    const ptr = JSON.parse(fs.readFileSync(this.pointerFile, 'utf8'));
    this.runDir = path.join(this.runsDir, ptr.runId);
    this.state = JSON.parse(fs.readFileSync(path.join(this.runDir, 'state.json'), 'utf8'));
  }

  logStage(msg) { this.deps.log(msg); }

  // ----- per-ticket workflow -----
  async runTicket(number) {
    const tdir = this.ticketDir(number);
    mkdirp(tdir);
    this.state.currentTicket = number;
    this.state.repairCycles = 0;

    // 1. Prepare
    const baseCommit = this.git('rev-parse HEAD').stdout.trim();
    this.state.baseCommit = baseCommit.slice(0, 7);
    const issueRes = this.gh(`issue view ${number} --json number,title,body,comments`);
    if (issueRes.code !== 0) return this.block(number, 'could not fetch issue');
    const issue = JSON.parse(issueRes.stdout);
    const issueFile = path.join(tdir, 'issue.txt');
    const comments = (issue.comments || []).map((c) => `--- comment ---\n${c.body}`).join('\n\n');
    fs.writeFileSync(issueFile, `#${number}: ${issue.title}\n\n${issue.body || ''}\n\n${comments}`);

    // 2. Implement
    const implDir = path.join(tdir, 'implementation');
    mkdirp(implDir);
    const impl = new PiSession(this.deps, {
      agentCfg: this.config.implementation,
      sessionDir: path.join(implDir, 'session'),
      rpcLogPath: path.join(implDir, 'rpc.log'),
      name: `impl-${number}`,
      skillPaths: this.skillPathsFor('implement'),
    });
    this.state.implementationSession = path.join(implDir, 'session');
    this.transition('implementing');
    this.logStage(`[#${number}] implementation started`);
    impl.start();
    const implPrompt = buildImplementationPrompt({ number, issueFile });
    fs.writeFileSync(path.join(implDir, 'prompt.txt'), implPrompt);
    let res = await impl.prompt(implPrompt);
    fs.writeFileSync(path.join(implDir, 'final.txt'), impl.lastAssistantText || '');
    if (!res.settled) { impl.stop(); return this.block(number, 'pi exited before agent_settled'); }
    this.logStage(`[#${number}] implementation settled`);

    if (fs.existsSync(path.join(this.coordDir, 'test-change-request.json'))) {
      impl.stop();
      return this.block(number, 'implementation raised a test-change-request; human review needed');
    }

    // 3/4/5. verify -> review loop
    for (;;) {
      // verify (repair on failure until it passes)
      const verifyOk = await this.verifyLoop(number, impl, tdir);
      if (verifyOk === 'blocked') { impl.stop(); return 'blocked'; }
      const verifyHash = this.trackedDiffHash();

      // review
      const verdict = await this.review(number, tdir, issueFile);
      if (verdict === 'blocked') { impl.stop(); return 'blocked'; }
      if (verdict.verdict === 'accept') {
        impl.stop();
        return this.accept(number, issue.title, verifyHash);
      }
      // reject -> repair the same implementation session
      this.state.repairCycles += 1;
      this.saveState();
      if (this.state.repairCycles > this.config.maxRepairCycles) {
        impl.stop();
        return this.block(number, `exceeded maxRepairCycles (${this.config.maxRepairCycles})`);
      }
      this.logStage(`[#${number}] repair ${this.state.repairCycles}/${this.config.maxRepairCycles} started`);
      this.transition('repairing');
      const feedback = buildRepairFromReview({ report: verdict.report });
      res = await impl.prompt(feedback);
      if (!res.settled) { impl.stop(); return this.block(number, 'pi exited during repair'); }
      // loop back to verify
    }
  }

  async verifyLoop(number, impl, tdir) {
    for (;;) {
      this.transition('verifying');
      const { ok, failedCmd, output, logFile } = this.runVerify(number, tdir);
      if (ok) { this.logStage(`[#${number}] verification passed`); return 'ok'; }
      this.state.repairCycles += 1;
      this.saveState();
      this.logStage(`[#${number}] verification failed: ${failedCmd}`);
      if (this.state.repairCycles > this.config.maxRepairCycles) {
        this.block(number, `exceeded maxRepairCycles during verification (log: ${logFile})`);
        return 'blocked';
      }
      this.logStage(`[#${number}] repair ${this.state.repairCycles}/${this.config.maxRepairCycles} started (verify)`);
      this.transition('repairing');
      const res = await impl.prompt(buildRepairFromVerify({ command: failedCmd, output }));
      if (!res.settled) { this.block(number, 'pi exited during verify-repair'); return 'blocked'; }
    }
  }

  runVerify(number, tdir) {
    const dir = path.join(tdir, 'verify');
    mkdirp(dir);
    const stamp = Date.now();
    const logFile = path.join(dir, `${stamp}.log`);
    let combined = '';
    for (const cmd of this.config.verify) {
      const r = this.deps.run(cmd, { cwd: this.root });
      combined += `$ ${cmd}\n${r.combined}\n(exit ${r.code})\n\n`;
      if (r.code !== 0) {
        fs.writeFileSync(logFile, combined);
        return { ok: false, failedCmd: cmd, output: r.combined, logFile };
      }
    }
    fs.writeFileSync(logFile, combined);
    this._lastVerifyLog = logFile;
    return { ok: true, logFile };
  }

  async review(number, tdir, issueFile) {
    this.transition('reviewing');
    const base = this.state.baseCommit;
    const rdir = path.join(tdir, 'review', String(this.state.repairCycles));
    mkdirp(rdir);
    const diffFile = path.join(rdir, 'diff.txt');
    const statFile = path.join(rdir, 'stat.txt');
    const verifyFile = this._lastVerifyLog || path.join(rdir, 'verify.txt');
    const testDiffFile = path.join(rdir, 'test-diff.txt');
    fs.writeFileSync(diffFile, this.git(`diff ${base} -- .`).stdout);
    fs.writeFileSync(statFile, this.git(`diff --stat ${base}`).stdout);
    fs.writeFileSync(testDiffFile, this.git(`diff ${base} -- '*test*' '*spec*' '*.e2e.*'`).stdout);

    const before = this.trackedDiffHash();
    const rev = new PiSession(this.deps, {
      agentCfg: this.config.review,
      sessionDir: path.join(rdir, 'session'),
      rpcLogPath: path.join(rdir, 'rpc.log'),
      name: `review-${number}-${this.state.repairCycles}`,
      skillPaths: this.skillPathsFor('review'),
    });
    rev.start();
    const prompt = buildReviewPrompt({ number, issueFile, baseCommit: base });
    fs.writeFileSync(path.join(rdir, 'prompt.txt'), prompt);
    const res = await rev.prompt(prompt);
    const report = rev.lastAssistantText || '';
    fs.writeFileSync(path.join(rdir, 'response.txt'), report);
    rev.stop();
    if (!res.settled) { this.block(number, 'reviewer exited before settling'); return 'blocked'; }

    const after = this.trackedDiffHash();
    if (after !== before) {
      this.block(number, 'reviewer modified tracked files; not auto-discarding');
      return 'blocked';
    }
    const parsed = parseReviewVerdict(report);
    parsed.report = report;
    writeJsonAtomic(path.join(rdir, 'verdict.json'), parsed);
    if (!parsed.ok) { this.block(number, `reviewer produced invalid verdict: ${parsed.reason}`); return 'blocked'; }
    if (parsed.verdict === 'accept') {
      this.logStage(`[#${number}] review accepted`);
    } else {
      this.logStage(`[#${number}] review rejected with ${parsed.findings.length} blocker(s)`);
    }
    return parsed;
  }

  accept(number, title, verifyHash) {
    // Confirm nothing changed since verification (else re-verify).
    if (this.trackedDiffHash() !== verifyHash) {
      const v = this.runVerify(number, this.ticketDir(number));
      if (!v.ok) return this.block(number, 'diff changed after review and re-verification failed');
    }
    this.git('add -A');
    const safeTitle = title.replace(/"/g, "'").replace(/`/g, "'");
    const commit = this.git(`commit -m "Implement #${number}: ${safeTitle}"`);
    if (commit.code !== 0) return this.block(number, `commit failed:\n${commit.combined}`);
    const shaShort = this.git('rev-parse HEAD').stdout.trim().slice(0, 7);
    this.logStage(`[#${number}] committed as ${shaShort}`);
    if (this.state.push) {
      const push = this.git(`push origin ${this.config.branch || 'dev'}`);
      if (push.code !== 0) return this.block(number, `push failed:\n${push.combined}`);
      const close = this.gh(`issue close ${number} --comment "Implemented and verified by coordinator (${shaShort}). Checks: ${this.config.verify.join(', ')}."`);
      if (close.code !== 0) return this.block(number, `issue close failed:\n${close.combined}`);
      this.logStage(`[#${number}] pushed and issue closed`);
    }
    this.state.accepted.push(number);
    this.transition('accepted');
    return 'accepted';
  }

  // ----- notification (push, not poll) -----
  // Called ONLY at terminal transitions: a ticket becomes `blocked` (needs a
  // human) or the whole run finishes (`done`). Writes a plain-text summary to
  // disk, then fires one configured command with the event described via env
  // vars. There is no loop and no timer anywhere in this path.
  writeSummary(event, extra = {}) {
    const s = this.state;
    const lines = [];
    lines.push(`Coordinator ${event.toUpperCase()} — run ${s.runId}`);
    lines.push(`Queue: ${s.tickets.join(', ')}`);
    lines.push(`Accepted: ${s.accepted.length ? s.accepted.join(', ') : '(none)'}`);
    if (event === 'blocked' && s.blocked) {
      lines.push('');
      lines.push(`BLOCKED on ticket #${s.blocked.ticket}: ${s.blocked.reason}`);
      lines.push(`Artifacts: ${this.ticketDir(s.blocked.ticket)}`);
      // If a reviewer produced a report, point at the latest one.
      const rroot = path.join(this.ticketDir(s.blocked.ticket), 'review');
      if (fs.existsSync(rroot)) {
        const cycles = fs.readdirSync(rroot).filter((d) => /^\d+$/.test(d)).sort((a, b) => +a - +b);
        const last = cycles[cycles.length - 1];
        if (last) lines.push(`Latest review report: ${path.join(rroot, last, 'response.txt')}`);
      }
      lines.push('');
      lines.push(`Resume after fixing with: node scripts/coordinate-tickets.mjs --resume`);
      lines.push(`Inspect with: node scripts/coordinator-status.mjs --ticket ${s.blocked.ticket}`);
    } else if (event === 'done') {
      lines.push('');
      lines.push(`All queued tickets accepted. Nothing left to do.`);
    }
    const summaryFile = path.join(this.runDir, `NOTIFY-${event}.txt`);
    writeAtomic(summaryFile, lines.join('\n') + '\n');
    return { summaryFile, text: lines.join('\n'), ...extra };
  }

  notify(event) {
    const cfg = this.config.notify || {};
    const on = cfg.on || ['blocked', 'done'];
    if (!on.includes(event)) return;
    const { summaryFile, text } = this.writeSummary(event);
    if (!cfg.command) {
      this.logStage(`(notify:${event}) summary written to ${summaryFile}; no notify.command configured`);
      return;
    }
    // The command is run once, with context in the environment. It can email,
    // curl a webhook, or wake a Shelley conversation — the coordinator does not
    // care which.
    const env = {
      COORD_EVENT: event,
      COORD_RUN_ID: this.state.runId,
      COORD_RUN_DIR: this.runDir,
      COORD_SUMMARY_FILE: summaryFile,
      COORD_SUMMARY: text,
      COORD_BLOCKED_TICKET: this.state.blocked ? String(this.state.blocked.ticket) : '',
      COORD_ACCEPTED: this.state.accepted.join(','),
    };
    const r = this.deps.run(cfg.command, { cwd: this.root, env });
    if (r.code !== 0) this.logStage(`(notify:${event}) command failed (exit ${r.code}): ${truncate(r.combined, 500)}`);
    else this.logStage(`(notify:${event}) sent`);
  }

  block(number, reason) {
    this.state.blocked = { ticket: number, reason, at: new Date().toISOString() };
    this.transition('blocked');
    this.logStage(`[#${number}] BLOCKED: ${reason}`);
    this.logStage(`  artifacts: ${this.ticketDir(number)}`);
    this.notify('blocked');
    return 'blocked';
  }

  async run() {
    const queue = this.state.tickets;
    const start = queue.indexOf(this.state.currentTicket);
    for (let i = Math.max(0, start); i < queue.length; i++) {
      const n = queue[i];
      if (this.state.accepted.includes(n)) continue;
      const outcome = await this.runTicket(n);
      if (outcome === 'blocked' || this.state.state === 'blocked') {
        this.logStage(`Run halted at ticket #${n}. Fix and re-run with --resume.`);
        return;
      }
    }
    this.logStage(`All tickets accepted: ${this.state.accepted.join(', ')}`);
    this.state.state = 'done';
    this.saveState();
    this.notify('done');
  }
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const opts = { tickets: null, resume: false, push: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tickets') opts.tickets = argv[++i].split(',').map((s) => parseInt(s.trim(), 10));
    else if (a === '--resume') opts.resume = true;
    else if (a === '--push') opts.push = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

async function main() {
  const root = process.cwd();
  const deps = makeDefaultDeps();
  const options = parseArgs(process.argv.slice(2));
  const configPath = path.join(root, 'coordinator.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const coord = new Coordinator({ deps, config, options, root });

  // graceful interruption
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    deps.log('\nInterrupted. State preserved; re-run with --resume.');
    try { coord.saveState(); } catch { /* ignore */ }
    process.exit(130);
  });

  if (options.resume) {
    coord.loadRun();
    // A ticket caught mid-flight during an unclean shutdown is not safe to auto-continue.
    if (['implementing', 'repairing', 'reviewing', 'verifying'].includes(coord.state.state)) {
      coord.logStage(`Resuming: ticket #${coord.state.currentTicket} was '${coord.state.state}' at shutdown; marking blocked for human review.`);
      coord.block(coord.state.currentTicket, `unclean shutdown while '${coord.state.state}'`);
      return;
    }
    if (options.push) coord.state.push = true;
    await coord.run();
    return;
  }

  if (!options.tickets || !options.tickets.length) {
    throw new Error('provide --tickets a,b,c or --resume');
  }
  const problems = coord.checkPreconditions(options.tickets);
  if (problems.length) {
    deps.log('Preconditions failed:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  coord.startRun(options.tickets);
  await coord.run();
}

// Only run main when executed directly (not when imported by tests).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
}
