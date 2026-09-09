// Real local Git repositories; GitHub and model processes are never invoked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Coordinator } from './coordinate-tickets.mjs';
import { acquireLock, checked, runCommand, snapshot } from './coordinator-runtime.mjs';

async function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => checked(runCommand, ['git', ...args], { cwd: root });
  await git('init', '-b', 'dev');
  await git('config', 'user.name', 'Coordinator Test');
  await git('config', 'user.email', 'coordinator-test@example.invalid');
  await git('config', 'core.filemode', 'true');
  fs.writeFileSync(path.join(root, '.gitignore'), '.coordinator/\n');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'original\n');
  fs.writeFileSync(path.join(root, 'delete.txt'), 'remove me\n');
  fs.writeFileSync(path.join(root, 'executable.sh'), '#!/bin/sh\nexit 0\n');
  await git('add', '.');
  await git('commit', '-m', 'Initial fixture');
  return { root, git, base: await git('rev-parse', 'HEAD') };
}

test('snapshot includes untracked bytes, deleted paths and executable modes without changing the caller index', async (t) => {
  const { root, git, base } = await repository(t);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'staged version\n');
  await git('add', 'keep.txt');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'working version\n');
  fs.writeFileSync(path.join(root, 'new file.txt'), 'new bytes\n');
  fs.unlinkSync(path.join(root, 'delete.txt'));
  fs.chmodSync(path.join(root, 'executable.sh'), 0o755);
  const before = fs.readFileSync(path.join(root, '.git', 'index'));
  const candidate = await snapshot(runCommand, root, path.join(root, '.coordinator', 'snapshots'), base);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), before);
  assert.deepEqual(candidate.files.sort(), ['delete.txt', 'executable.sh', 'keep.txt', 'new file.txt']);
  assert.equal(await git('show', `${candidate.tree}:keep.txt`), 'working version');
  assert.equal(await git('show', ':keep.txt'), 'staged version');
  assert.equal(await git('show', `${candidate.tree}:new file.txt`), 'new bytes');
  assert.match(await git('ls-tree', candidate.tree, 'executable.sh'), /^100755 /);
  assert.equal(await git('ls-tree', candidate.tree, 'delete.txt'), '');
  fs.writeFileSync(path.join(root, 'new file.txt'), 'changed bytes\n');
  const revised = await snapshot(runCommand, root, path.join(root, '.coordinator', 'snapshots'), base);
  assert.notEqual(revised.tree, candidate.tree);
});

test('run locks exclude contenders and release only their own ownership token', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = acquireLock(dir);
  assert.throws(() => acquireLock(dir), /lock exists/);
  const file = path.join(dir, 'run.lock');
  fs.writeFileSync(file, JSON.stringify({ token: 'replacement-owner' }));
  release();
  assert.equal(JSON.parse(fs.readFileSync(file)).token, 'replacement-owner');
  fs.unlinkSync(file);
  acquireLock(dir)();
  assert.equal(fs.existsSync(file), false);
});

test('command deadline kills stubborn descendants even when the process leader exits first', { skip: process.platform !== 'linux' }, async (t) => {
  let descendant;
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch { /* already gone */ } } });
  const childScript = "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);";
  const parentScript = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:['ignore','pipe','ignore']}); c.stdout.once('data',()=>console.log(c.pid)); setInterval(()=>{},1000);`;
  const result = await runCommand([process.execPath, '-e', parentScript], { timeoutMs: 500 });
  descendant = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0, 'child acknowledged installing its TERM handler');
  assert.equal(result.code, 124);
  await new Promise(resolve => setTimeout(resolve, 1100));
  let alive = false;
  try {
    const stat = fs.readFileSync(`/proc/${descendant}/stat`, 'utf8');
    alive = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch { /* gone */ }
  assert.equal(alive, false, 'deadline escalation must outlive the process leader');
});

async function workflow(t, { changeRootOnReview = false, title = 'Implement fixture', interruptIndexUpdate = false } = {}) {
  const repo = await repository(t);
  const calls = [];
  const prompts = [];
  const run = async (command, options) => {
    calls.push(command);
    assert.ok(Array.isArray(command), 'fixture expects argv commands, never interpolated shell');
    if (command[0] === 'gh') {
      assert.equal(command[1], 'issue');
      assert.equal(command[2], 'view', 'this no-push workflow must never close an issue');
      const stdout = JSON.stringify({ number: 17, title, body: 'Add a fixture file', state: 'OPEN', comments: [] });
      return { code: 0, stdout, stderr: '', combined: stdout };
    }
    if (interruptIndexUpdate && command[0] === 'git' && command[1] === 'read-tree' && !options?.env?.GIT_INDEX_FILE) {
      interruptIndexUpdate = false;
      return { code: 1, stdout: '', stderr: 'simulated interruption', combined: 'simulated interruption' };
    }
    return runCommand(command, options);
  };
  class FakeSession {
    constructor(_deps, options) { this.options = options; }
    start() {}
    stop() {}
    async prompt(prompt) {
      prompts.push(prompt);
      let value;
      if (this.options.name.startsWith('implementation')) {
        fs.writeFileSync(path.join(this.options.cwd, 'new file.txt'), 'implemented\n');
        fs.unlinkSync(path.join(this.options.cwd, 'delete.txt'));
        value = { status: 'complete', summary: 'Added fixture', tests: [], testQuality: 'Fixture assertions checked by the coordinator integration test' };
      } else {
        if (changeRootOnReview) fs.writeFileSync(path.join(repo.root, 'keep.txt'), 'user changes during review\n');
        const candidateId = /Candidate identity: ([a-f0-9]+)\./.exec(prompt)?.[1];
        assert.ok(candidateId, 'review prompt includes immutable tree ID');
        value = { candidateId, verdict: 'accept', findings: [], resolvedFindingIds: [] };
      }
      return { settled: true, lastAssistantText: JSON.stringify(value), reason: 'settled' };
    }
  }
  const coordinator = new Coordinator({ root: repo.root, config: {
    branch: 'dev', implementation: { provider: 'fake', model: 'fake' }, review: { provider: 'fake', model: 'fake' },
    verification: { quick: [], full: [['git', 'diff', '--check']], affected: [{ match: '.*', commands: [] }] },
  }, deps: { run, Session: FakeSession, log: () => {} } });
  const release = acquireLock(path.join(repo.root, '.coordinator'));
  t.after(release);
  await coordinator.checkPreconditions([17]);
  await coordinator.startRun([17]);
  const result = await coordinator.run();
  return { ...repo, coordinator, result, calls, prompts };
}

test('accepted commit is exactly the reviewed and verified tree, including new and deleted files', async (t) => {
  const { root, git, coordinator, result, calls } = await workflow(t);
  assert.equal(result, 'done', JSON.stringify(coordinator.state.blocked));
  const ticket = coordinator.state.ticketState;
  assert.equal(await git('rev-parse', 'HEAD^{tree}'), ticket.reviewedTree);
  assert.equal(await git('rev-parse', 'HEAD^{tree}'), ticket.verifiedTree);
  assert.equal(await git('rev-parse', 'HEAD'), ticket.checkpoints.commit);
  assert.equal(fs.readFileSync(path.join(root, 'new file.txt'), 'utf8'), 'implemented\n');
  assert.equal(fs.existsSync(path.join(root, 'delete.txt')), false);
  assert.equal(await git('status', '--porcelain'), '');
  assert.ok(calls.some(command => command[0] === 'git' && command[1] === 'commit-tree'));
});

test('shell metacharacters in issue titles remain literal commit-message text', async (t) => {
  const title = 'Do $(touch SHELL_EXPANDED) `touch BACKTICK_EXPANDED`; echo "quotes"';
  const { root, git, coordinator, result } = await workflow(t, { title });
  assert.equal(result, 'done', JSON.stringify(coordinator.state.blocked));
  assert.equal(await git('log', '-1', '--format=%s'), `Implement #17: ${title}`);
  for (const dir of [root, coordinator.workDir]) {
    assert.equal(fs.existsSync(path.join(dir, 'SHELL_EXPANDED')), false);
    assert.equal(fs.existsSync(path.join(dir, 'BACKTICK_EXPANDED')), false);
  }
});

test('user changes in the launch checkout after review block integration without overwriting them', async (t) => {
  const { root, git, base, coordinator, result } = await workflow(t, { changeRootOnReview: true });
  assert.equal(result, 'blocked');
  assert.equal(coordinator.state.blocked.kind, 'integration');
  assert.equal(await git('rev-parse', 'HEAD'), base);
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'user changes during review\n');
  assert.equal(fs.existsSync(path.join(root, 'new file.txt')), false);
  assert.ok(coordinator.state.ticketState.checkpoints.commit, 'reviewed commit is retained for resume');
  assert.equal(coordinator.state.ticketState.checkpoints.integrated, undefined);
});

test('resume reconciles the worker index after interruption between HEAD and index publication', async (t) => {
  const { coordinator, result } = await workflow(t, { interruptIndexUpdate: true });
  assert.equal(result, 'blocked');
  assert.match(coordinator.state.blocked.reason, /simulated interruption/);
  coordinator.loadRun();
  assert.equal(await coordinator.run(), 'done', JSON.stringify(coordinator.state.blocked));
  const status = await checked(runCommand, ['git', 'status', '--porcelain'], { cwd: coordinator.workDir });
  assert.equal(status, '', 'resumed publication must leave the worker index consistent with HEAD');
});
