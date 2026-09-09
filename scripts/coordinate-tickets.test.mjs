import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Coordinator } from './coordinate-tickets.mjs';
import { runCommand } from './coordinator-runtime.mjs';

const INITIAL_ISSUE = {
  number: 7,
  title: 'Implement the isolated feature',
  body: 'Add the feature and preserve the public behavior.',
  comments: [],
};

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', combined: stdout, timedOut: false, durationMs: 0 });
const fail = (output) => ({ code: 1, stdout: '', stderr: output, combined: output, timedOut: false, durationMs: 0 });

async function git(cwd, ...args) {
  const result = await runCommand(['git', ...args], { cwd });
  if (result.code) throw new Error(`git ${args.join(' ')} failed: ${result.combined}`);
  return result.stdout.trim();
}

async function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-workflow-'));
  await git(root, 'init', '-b', 'dev');
  await git(root, 'config', 'user.email', 'coordinator-test@example.invalid');
  await git(root, 'config', 'user.name', 'Coordinator Test');
  fs.writeFileSync(path.join(root, '.gitignore'), '.coordinator/\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  await git(root, 'add', '.gitignore', 'README.md');
  await git(root, 'commit', '-m', 'initial');
  return root;
}

function writeCounterScript(directory) {
  const script = path.join(directory, 'count-check.mjs');
  fs.writeFileSync(script, `
import fs from 'node:fs';
import path from 'node:path';
const [counterFile, kind, mode] = process.argv.slice(2);
const counts = fs.existsSync(counterFile) ? JSON.parse(fs.readFileSync(counterFile, 'utf8')) : {};
counts[kind] = (counts[kind] || 0) + 1;
fs.writeFileSync(counterFile, JSON.stringify(counts));
if (!fs.existsSync(path.join(process.cwd(), 'feature.txt'))) {
  console.error('feature.txt is missing');
  process.exit(1);
}
if ((mode === 'fail-full-once' && kind === 'full' && counts[kind] === 1) ||
    (mode === 'fail-quick-once' && kind === 'quick' && counts[kind] === 1)) {
  console.error('scripted verification failure');
  process.exit(1);
}
`);
  return script;
}

function readCounts(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function readEvents(runDir) {
  const file = path.join(runDir, 'events.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function implementationResult(summary = 'Implemented the feature.') {
  return JSON.stringify({
    status: 'complete',
    summary,
    tests: [{ command: 'targeted check', result: 'passed' }],
    testQuality: 'The changed public behavior has a regression assertion.',
  });
}

function finding() {
  return {
    id: 'F1',
    title: 'The candidate needs the requested behavior',
    evidence: 'The captured candidate does not yet prove the criterion.',
    requiredChange: 'Implement the criterion and keep its targeted assertion.',
    severity: 'high',
    criterion: 'The public feature behavior is implemented.',
  };
}

function responseForReview(message, response) {
  const candidateId = message.match(/Candidate identity: ([^.\s]+)\./)?.[1];
  assert.ok(candidateId, 'review prompt must carry a candidate identity');
  if (response === 'reject') {
    return JSON.stringify({ candidateId, verdict: 'reject', findings: [finding()], resolvedFindingIds: [] });
  }
  if (response === 'accept-resolved') {
    return JSON.stringify({ candidateId, verdict: 'accept', findings: [], resolvedFindingIds: ['F1'] });
  }
  return JSON.stringify({ candidateId, verdict: 'accept', findings: [], resolvedFindingIds: [] });
}

function makeHarness({ reviewResponses = ['accept'], implementationResponses = [], verifyMode = 'pass', pushFailures = 0 } = {}) {
  const scenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-fixture-'));
  const counterFile = path.join(scenarioRoot, 'counts.json');
  const counterScript = writeCounterScript(scenarioRoot);
  const sessions = [];
  const calls = { implementation: 0, review: 0, gh: [], pushes: 0, real: [] };
  const issue = { ...INITIAL_ISSUE };
  let currentPushFailures = pushFailures;

  const quick = ['node', counterScript, counterFile, 'quick', verifyMode];
  const full = ['node', counterScript, counterFile, 'full', verifyMode];
  const config = {
    branch: 'dev',
    setup: [],
    verification: {
      quick: [quick],
      full: [full],
      affected: [{ match: '^feature\\.txt$', commands: [] }],
      required: [],
    },
    maxRepairCycles: 5,
    maxAgentTurns: 20,
    maxProtocolErrors: 2,
    maxEnvironmentRetries: 1,
    implementation: { provider: 'fake', model: 'fake' },
    review: { provider: 'fake', model: 'fake' },
    skills: {},
  };

  async function run(command, options = {}) {
    const argv = Array.isArray(command) ? command : [command];
    if (argv[0] === 'gh') {
      calls.gh.push(argv);
      if (argv[1] !== 'issue') throw new Error(`unexpected fake gh command: ${argv.join(' ')}`);
      if (argv[2] === 'view') {
        if (argv.includes('title,body,comments')) return ok(JSON.stringify(issue));
        return ok(JSON.stringify({ number: issue.number, state: issue.state || 'OPEN' }));
      }
      if (argv[2] === 'close') {
        issue.state = 'CLOSED';
        return ok();
      }
      throw new Error(`unexpected fake gh command: ${argv.join(' ')}`);
    }
    if (argv[0] === 'git' && argv[1] === 'push') {
      calls.pushes++;
      if (currentPushFailures > 0) {
        currentPushFailures--;
        return fail('scripted push failure');
      }
      return ok();
    }
    if (['curl', 'ssh', 'shelley'].includes(argv[0])) throw new Error(`external command escaped fake harness: ${argv.join(' ')}`);
    calls.real.push(argv);
    return runCommand(command, options);
  }

  class ScriptedSession {
    constructor(_deps, options) {
      this.cwd = options.cwd;
      this.role = options.name.startsWith('implementation') ? 'implementation' : 'review';
      this.prompts = [];
      this.stopped = false;
      sessions.push(this);
    }

    start() {}

    async prompt(message) {
      this.prompts.push(message);
      calls[this.role]++;
      if (this.role === 'implementation') {
        const response = implementationResponses[calls.implementation - 1] || 'complete';
        if (response === 'blocked') {
          return { settled: true, lastAssistantText: JSON.stringify({
            status: 'blocked', reason: 'The ticket specification is contradictory.', kind: 'spec',
          }) };
        }
        if (response === 'malformed') return { settled: true, lastAssistantText: 'not a typed result' };
        fs.writeFileSync(path.join(this.cwd, 'feature.txt'), `version-${calls.implementation}\n`);
        return { settled: true, lastAssistantText: implementationResult() };
      }
      const response = reviewResponses[calls.review - 1] || 'accept';
      if (response === 'malformed') return { settled: true, lastAssistantText: 'review prose without the required JSON result' };
      return { settled: true, lastAssistantText: responseForReview(message, response) };
    }

    stop() { this.stopped = true; }
  }

  return {
    config,
    counterFile,
    calls,
    sessions,
    deps: { run, Session: ScriptedSession },
    cleanup: () => fs.rmSync(scenarioRoot, { recursive: true, force: true }),
  };
}

async function startHarness(harness, options = {}) {
  const root = await makeRepository();
  const coordinator = new Coordinator({ root, options, config: harness.config, deps: harness.deps });
  await coordinator.startRun([INITIAL_ISSUE.number]);
  return { root, coordinator };
}

async function cleanupRepository(root, harness) {
  try {
    const pointer = path.join(root, '.coordinator', 'current-run.json');
    if (fs.existsSync(pointer)) {
      const { runId } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
      const worktree = path.join(root, '.coordinator', 'runs', runId, 'worktree');
      if (fs.existsSync(worktree)) await runCommand(['git', 'worktree', 'remove', '--force', worktree], { cwd: root });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    harness.cleanup();
  }
}

test('runs the full suite only after review accepts the captured candidate', async (t) => {
  const harness = makeHarness();
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'done');
  const events = readEvents(coordinator.runDir);
  const reviewIndex = events.findIndex(event => event.type === 'review_verdict' && event.verdict === 'accept');
  const fullIndex = events.findIndex((event, index) => index > reviewIndex && event.type === 'command_started' && event.stage === 'full');
  assert.ok(reviewIndex >= 0);
  assert.ok(fullIndex > reviewIndex, 'full verification starts after review acceptance');
  assert.deepEqual(readCounts(harness.counterFile), { quick: 2, full: 1 });
  assert.equal(coordinator.state.state, 'done');
  assert.deepEqual(coordinator.state.accepted, [7]);
  assert.equal(harness.calls.gh.length, 1, 'issue read was intercepted and no external GitHub call escaped');
  assert.ok(harness.calls.real.every(([program]) => !['curl', 'ssh', 'shelley'].includes(program)), 'no unsupported external command escaped');
});

test('repairs a rejected review and resolves the same finding in the persistent ledger', async (t) => {
  const harness = makeHarness({ reviewResponses: ['reject', 'accept-resolved'] });
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'done');
  assert.equal(harness.calls.implementation, 2);
  assert.equal(harness.calls.review, 2);
  assert.equal(coordinator.state.ticketState.repairCycles, 1);
  assert.deepEqual(coordinator.state.ticketState.ledger.map(({ id, status }) => ({ id, status })), [{ id: 'F1', status: 'resolved' }]);
  assert.match(fs.readFileSync(path.join(coordinator.ticketDir(), 'findings.json'), 'utf8'), /F1/);
});

test('retries malformed implementation schema without running verification first', async (t) => {
  const harness = makeHarness({ implementationResponses: ['malformed', 'complete'] });
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'done');
  assert.equal(harness.calls.implementation, 2);
  const events = readEvents(coordinator.runDir);
  const firstFinished = events.findIndex(event => event.type === 'agent_finished');
  const secondStarted = events.findIndex((event, index) => index > firstFinished && event.type === 'agent_started');
  const firstCommand = events.findIndex(event => event.type === 'command_started');
  assert.ok(firstCommand > secondStarted, 'verification begins only after a valid implementation result');
  assert.equal(coordinator.state.ticketState.protocolErrors, 1);
  assert.deepEqual(readCounts(harness.counterFile), { quick: 2, full: 1 });
});

test('a blocked implementation stops before verification or review', async (t) => {
  const harness = makeHarness({ implementationResponses: ['blocked'] });
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'blocked');
  assert.equal(coordinator.state.blocked.kind, 'spec');
  assert.equal(harness.calls.implementation, 1);
  assert.equal(harness.calls.review, 0);
  assert.deepEqual(readCounts(harness.counterFile), {});
});

test('push failure resumes publication without new agents or a second commit', async (t) => {
  const harness = makeHarness({ pushFailures: 1 });
  const { root, coordinator } = await startHarness(harness, { push: true });
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'blocked');
  assert.equal(coordinator.state.blocked.kind, 'publication');
  const firstRunDir = coordinator.runDir;
  const firstCommit = coordinator.state.ticketState.checkpoints.commit;
  const sessionsBeforeResume = harness.sessions.length;
  const commitsBeforeResume = readEvents(firstRunDir).filter(event => event.type === 'committed');

  const resumed = new Coordinator({ root, options: { push: true }, config: harness.config, deps: harness.deps });
  resumed.loadRun();
  assert.equal(resumed.state.ticketState.agentTurns, coordinator.state.ticketState.agentTurns, 'agent budget survives load');
  assert.equal(resumed.state.ticketState.repairCycles, coordinator.state.ticketState.repairCycles, 'repair budget survives load');
  assert.equal(await resumed.run(), 'done');
  assert.equal(harness.sessions.length, sessionsBeforeResume, 'resume does not create agents');
  assert.deepEqual(readEvents(firstRunDir).filter(event => event.type === 'committed'), commitsBeforeResume, 'resume does not create a second commit');
  assert.equal(await git(root, 'rev-parse', 'HEAD'), firstCommit);
  assert.equal(harness.calls.pushes, 2);
});

test('full-gate verification failure repairs and re-reviews the candidate', async (t) => {
  const harness = makeHarness({ verifyMode: 'fail-full-once', reviewResponses: ['accept', 'accept'] });
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));

  assert.equal(await coordinator.run(), 'done');
  assert.equal(harness.calls.implementation, 2);
  assert.equal(harness.calls.review, 2);
  assert.deepEqual(readCounts(harness.counterFile), { quick: 4, full: 2 });
  const events = readEvents(coordinator.runDir);
  assert.ok(events.some(event => event.type === 'command_finished' && event.stage === 'full' && event.code === 1));
  assert.equal(events.filter(event => event.type === 'committed').length, 1);
});

test('a queue integrates each ticket in order and starts separate role sessions for the next ticket', async (t) => {
  const harness = makeHarness();
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));
  coordinator.state.tickets = [7, 8];
  coordinator.saveState();
  assert.equal(await coordinator.run(), 'done');
  assert.deepEqual(coordinator.state.accepted, [7, 8]);
  assert.equal(harness.sessions.length, 4);
  assert.equal(await git(root, 'rev-list', '--count', 'HEAD'), '3');
  assert.equal(fs.readFileSync(path.join(root, 'feature.txt'), 'utf8'), 'version-2\n');
});

test('accept cannot silently drop an unresolved finding from the ledger', async (t) => {
  const harness = makeHarness({ reviewResponses: ['reject', 'accept'] });
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));
  assert.equal(await coordinator.run(), 'blocked');
  assert.equal(coordinator.state.blocked.kind, 'protocol');
  assert.equal(await git(root, 'rev-list', '--count', 'HEAD'), '1');
});

test('an exhausted turn budget survives process recreation and cannot run another agent', async (t) => {
  const harness = makeHarness();
  harness.config.maxAgentTurns = 1;
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));
  assert.equal(await coordinator.run(), 'blocked');
  assert.equal(coordinator.state.blocked.kind, 'budget');
  const resumed = new Coordinator({ root, deps: harness.deps });
  resumed.loadRun();
  assert.equal(await resumed.run(), 'blocked');
  assert.equal(harness.calls.implementation, 1);
  assert.equal(harness.calls.review, 0);
});

test('CLI resumes a completed run from its frozen config even when current config is invalid', async (t) => {
  const harness = makeHarness();
  const { root, coordinator } = await startHarness(harness);
  t.after(() => cleanupRepository(root, harness));
  assert.equal(await coordinator.run(), 'done');
  fs.writeFileSync(path.join(root, 'coordinator.config.json'), '{invalid json');
  const result = await runCommand([process.execPath, fileURLToPath(new URL('./coordinate-tickets.mjs', import.meta.url)), '--resume'], { cwd: root });
  assert.equal(result.code, 0, result.combined);
  assert.equal(fs.existsSync(path.join(root, '.coordinator', 'run.lock')), false);
});
