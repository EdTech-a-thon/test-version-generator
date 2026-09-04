// Tests for the coordinator. Uses node:test with fully injected deps: no real
// pi/git/gh calls, no GitHub mutation, no commits, no model calls.
//
//   node --test scripts/coordinate-tickets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import {
  Coordinator, parseReviewVerdict, parseArgs,
  buildImplementationPrompt, buildReviewPrompt, buildRepairFromReview,
} from './coordinate-tickets.mjs';

// ---- a fake `pi --mode rpc` child driven by a scripted responder ----
// The responder is a function(promptText, callIndex) -> { assistantText, settle }.
function makeFakeSpawn(scripts) {
  // scripts: array consumed in the order sessions are started; each element is
  // a responder function. We track which session we are on via a counter.
  let sessionIndex = -1;
  return function fakeSpawn(_cmd, _args) {
    sessionIndex += 1;
    const responder = scripts[sessionIndex] || (() => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }));
    let callIndex = -1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.stdin = {
      write(line) {
        const cmd = JSON.parse(line.trim());
        if (cmd.type !== 'prompt') return;
        callIndex += 1;
        const out = responder(cmd.message, callIndex, child);
        // emit assistant message_end then agent_settled (async, next tick)
        setImmediate(() => {
          if (out.assistantText != null) {
            child.stdout.emit('data', JSON.stringify({
              type: 'message_end',
              message: { role: 'assistant', content: [{ type: 'text', text: out.assistantText }] },
            }) + '\n');
          }
          if (out.settle) child.stdout.emit('data', JSON.stringify({ type: 'agent_settled' }) + '\n');
          else { child.emit('exit', 1); }
        });
      },
      end() {},
    };
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    return child;
  };
}

// ---- a fake shell runner for git/gh/verify ----
function makeFakeRun(handlers) {
  return function run(cmd) {
    for (const [re, fn] of handlers) {
      if (re.test(cmd)) return fn(cmd);
    }
    return { code: 0, stdout: '', stderr: '', combined: '' };
  };
}

function ok(stdout = '') { return { code: 0, stdout, stderr: '', combined: stdout }; }
function fail(out = '', code = 1) { return { code, stdout: '', stderr: out, combined: out }; }

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-'));
  fs.writeFileSync(path.join(d, 'coordinator.config.json'), '{}');
  return d;
}

function baseConfig(overrides = {}) {
  return {
    branch: 'dev',
    verify: ['npm test'],
    maxRepairCycles: 2,
    implementation: { provider: 'p', model: 'm', thinking: 'high' },
    review: { provider: 'p', model: 'm', thinking: 'high' },
    ...overrides,
  };
}

// A git/gh handler set that emulates a clean repo with a mutable diff hash.
function gitGhHandlers(state) {
  state.diff = state.diff || 'seed';
  return [
    [/^gh issue view (\d+) --json number,state,title/, (c) => {
      const n = c.match(/view (\d+)/)[1];
      return ok(JSON.stringify({ number: +n, state: 'OPEN', title: `Ticket ${n}` }));
    }],
    [/^gh issue view (\d+) --json number,title,body,comments/, (c) => {
      const n = c.match(/view (\d+)/)[1];
      return ok(JSON.stringify({ number: +n, title: `Ticket ${n}`, body: 'do it', comments: [] }));
    }],
    [/^gh auth status/, () => ok('logged in')],
    [/^gh issue close/, () => ok('')],
    [/^git rev-parse --abbrev-ref HEAD/, () => ok('dev\n')],
    [/^git rev-parse HEAD/, () => ok('abc1234567\n')],
    [/^git status --porcelain/, () => ok('')],
    [/^git check-ignore/, () => ok('.coordinator\n')],
    [/^git diff HEAD/, () => ok(state.diff)],
    [/^git diff --stat/, () => ok('stat')],
    [/^git diff /, () => ok('the diff')],
    [/^git add/, () => ok('')],
    [/^git commit/, () => ok('')],
    [/^git push/, () => ok('')],
    [/^command -v/, () => ok('/usr/bin/x')],
  ];
}

function makeCoord(root, config, deps, options = {}) {
  const logs = [];
  const fullDeps = { log: (l) => logs.push(l), now: () => 'RUNID', ...deps };
  const coord = new Coordinator({ deps: fullDeps, config, options, root });
  coord._logs = logs;
  return coord;
}

// ============ unit tests ============

test('parseReviewVerdict accepts plain JSON', () => {
  const r = parseReviewVerdict('{"verdict":"accept","findings":[]}');
  assert.equal(r.ok, true); assert.equal(r.verdict, 'accept');
});

test('parseReviewVerdict handles fenced JSON and trailing prose', () => {
  const r = parseReviewVerdict('Here you go:\n```json\n{"verdict":"reject","findings":[{"title":"x"}]}\n```');
  assert.equal(r.ok, true); assert.equal(r.verdict, 'reject'); assert.equal(r.findings.length, 1);
});

test('parseReviewVerdict rejects invalid JSON', () => {
  assert.equal(parseReviewVerdict('not json at all').ok, false);
  assert.equal(parseReviewVerdict('{"verdict":"maybe"}').ok, false);
});

test('parseArgs parses tickets/resume/push', () => {
  assert.deepEqual(parseArgs(['--tickets', '6,7,8']).tickets, [6, 7, 8]);
  assert.equal(parseArgs(['--resume']).resume, true);
  assert.equal(parseArgs(['--tickets', '6', '--push']).push, true);
});

test('prompts invoke the Matt Pocock skills and carry the coordinator contract', () => {
  const p = buildImplementationPrompt({ number: 6, issueFile: '/x/issue.txt' });
  assert.match(p, /\/skill:implement/);
  assert.match(p, /ticket #6/);
  assert.match(p, /do NOT commit|Do NOT commit|do not commit/i);
  const rp = buildReviewPrompt({ number: 6, issueFile: 'i', baseCommit: 'abc1234' });
  assert.match(rp, /\/skill:code-review/);
  assert.match(rp, /abc1234\.\.\.HEAD/);
  assert.match(rp, /do NOT edit|MUST NOT edit|do not edit/i);
  assert.match(rp, /"verdict"/);
});

// ============ AC1: happy path, two tickets ============

test('AC1: two tickets accept immediately, commit, advance', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  // sessions started in order: impl#6, review#6, impl#7, review#7
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'done', settle: true }),                             // impl 6
    () => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }), // review 6
    () => ({ assistantText: 'done', settle: true }),                             // impl 7
    () => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }), // review 7
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn }, { push: false });
  coord.startRun([6, 7]);
  await coord.run();
  assert.deepEqual(coord.state.accepted, [6, 7]);
  assert.equal(coord.state.state, 'done');
  assert.ok(coord._logs.some((l) => /#6\] committed/.test(l)));
  assert.ok(coord._logs.some((l) => /#7\] committed/.test(l)));
});

// ============ AC2: verify fails -> repair same session, no reviewer yet ============

test('AC2: failed verify repairs impl session without a reviewer', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  let reviewerStarted = 0;
  let verifyCalls = 0;
  const spawn = makeFakeSpawn([
    // impl session handles both the initial prompt and the repair prompt
    (msg, callIndex) => ({ assistantText: `impl call ${callIndex}`, settle: true }),
    // any later session would be the reviewer
    () => { reviewerStarted += 1; return { assistantText: '{"verdict":"accept","findings":[]}', settle: true }; },
  ]);
  const handlers = gitGhHandlers(state);
  handlers.unshift([/^npm test/, () => {
    verifyCalls += 1;
    return verifyCalls === 1 ? fail('boom') : ok('pass');
  }]);
  const run = makeFakeRun(handlers);
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.accepted.includes(6), true);
  assert.equal(reviewerStarted, 1, 'reviewer runs only after verify passes');
  assert.ok(coord.state.repairCycles >= 1);
});

// ============ AC3/AC4: reject -> resume impl, fresh reviewer, then accept ============

test('AC3/AC4: rejected review resumes impl and uses a fresh reviewer, then accepts', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  let implCalls = 0;
  const reviewerSessions = [];
  const spawn = makeFakeSpawn([
    (msg, ci) => { implCalls += 1; return { assistantText: `impl ${ci}`, settle: true }; }, // impl (reused)
    () => { reviewerSessions.push('r1'); return { assistantText: '{"verdict":"reject","findings":[{"title":"fix"}]}', settle: true }; },
    () => { reviewerSessions.push('r2'); return { assistantText: '{"verdict":"accept","findings":[]}', settle: true }; },
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(implCalls, 2, 'impl session reused for repair');
  assert.deepEqual(reviewerSessions, ['r1', 'r2'], 'two distinct reviewer sessions');
  assert.equal(coord.state.accepted.includes(6), true);
});

// ============ AC5: exceeding repair cycles blocks ============

test('AC5: more than maxRepairCycles blocks the run', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'impl', settle: true }), // impl reused
    () => ({ assistantText: '{"verdict":"reject","findings":[{"title":"a"}]}', settle: true }),
    () => ({ assistantText: '{"verdict":"reject","findings":[{"title":"b"}]}', settle: true }),
    () => ({ assistantText: '{"verdict":"reject","findings":[{"title":"c"}]}', settle: true }),
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig({ maxRepairCycles: 2 }), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.state, 'blocked');
  assert.match(coord.state.blocked.reason, /maxRepairCycles/);
});

// ============ AC6: invalid reviewer JSON blocks ============

test('AC6: invalid reviewer JSON blocks the run', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'impl', settle: true }),
    () => ({ assistantText: 'I think it looks fine honestly', settle: true }),
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.state, 'blocked');
  assert.match(coord.state.blocked.reason, /invalid verdict/);
});

// ============ AC7: reviewer edits detected ============

test('AC7: reviewer edits to tracked files block the run', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'impl', settle: true }),
    (msg, ci, child) => {
      // simulate the reviewer mutating tracked files mid-review
      state.diff = 'reviewer changed this';
      return { assistantText: '{"verdict":"accept","findings":[]}', settle: true };
    },
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.state, 'blocked');
  assert.match(coord.state.blocked.reason, /reviewer modified/);
});

// ============ AC: pi exits without settling -> blocked ============

test('impl that exits without agent_settled blocks', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    () => ({ assistantText: null, settle: false }), // dies without settling
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.state, 'blocked');
  assert.match(coord.state.blocked.reason, /agent_settled/);
});

// ============ preconditions ============

test('preconditions fail on wrong branch and dirty tree', () => {
  const root = tmpRoot();
  const handlers = [
    [/^command -v/, () => ok('/x')],
    [/^git rev-parse --abbrev-ref HEAD/, () => ok('feature\n')],
    [/^git status --porcelain/, () => ok(' M src/x.ts\n')],
    [/^gh auth status/, () => ok('')],
    [/^gh issue view/, () => ok(JSON.stringify({ number: 6, state: 'OPEN', title: 't' }))],
    [/^git check-ignore/, () => ok('')],
  ];
  const coord = makeCoord(root, baseConfig(), { run: makeFakeRun(handlers), spawn: () => {} });
  const problems = coord.checkPreconditions([6]);
  assert.ok(problems.some((p) => /branch/.test(p)));
  assert.ok(problems.some((p) => /modified/.test(p)));
});

test('preconditions fail when issue is closed', () => {
  const root = tmpRoot();
  const handlers = gitGhHandlers({ diff: 'seed' }).slice();
  handlers.unshift([/^gh issue view (\d+) --json number,state,title/, () => ok(JSON.stringify({ number: 6, state: 'CLOSED', title: 't' }))]);
  const coord = makeCoord(root, baseConfig(), { run: makeFakeRun(handlers), spawn: () => {} });
  const problems = coord.checkPreconditions([6]);
  assert.ok(problems.some((p) => /not open/.test(p)));
});

// ============ AC10: interrupted run resumes to a safe boundary ============

test('AC10: state persisted after transitions and reload works', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'done', settle: true }),
    () => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }),
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6, 7]);
  await coord.runTicket(6);
  // reload from disk into a fresh coordinator
  const coord2 = makeCoord(root, baseConfig(), { run, spawn });
  coord2.loadRun();
  assert.equal(coord2.state.accepted.includes(6), true);
  assert.ok(fs.existsSync(path.join(coord2.runDir, 'state.json')));
});

test('test-change-request file blocks the ticket', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const spawn = makeFakeSpawn([
    (msg, ci, child) => {
      fs.mkdirSync(path.join(root, '.coordinator'), { recursive: true });
      fs.writeFileSync(path.join(root, '.coordinator', 'test-change-request.json'), '{"why":"conflict"}');
      return { assistantText: 'raised a request', settle: true };
    },
  ]);
  const run = makeFakeRun(gitGhHandlers(state));
  const coord = makeCoord(root, baseConfig(), { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.equal(coord.state.state, 'blocked');
  assert.match(coord.state.blocked.reason, /test-change-request/);
});
test('notify fires once on block and once on done, no polling', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const notifications = [];
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'done', settle: true }),
    () => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }),
  ]);
  const handlers = gitGhHandlers(state);
  const baseRun = makeFakeRun(handlers);
  // wrap run to capture the notify command invocation
  const run = (cmd, opts) => {
    if (opts && opts.env && opts.env.COORD_EVENT) {
      notifications.push({ event: opts.env.COORD_EVENT, ticket: opts.env.COORD_BLOCKED_TICKET, cmd });
      return ok('');
    }
    return baseRun(cmd, opts);
  };
  const cfg = baseConfig({ notify: { on: ['blocked', 'done'], command: 'send-it' } });
  const coord = makeCoord(root, cfg, { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.deepEqual(notifications.map((n) => n.event), ['done']);
  assert.equal(coord.state.state, 'done');
  // summary file exists
  assert.ok(fs.existsSync(path.join(coord.runDir, 'NOTIFY-done.txt')));
});

test('notify fires on block with the blocked ticket in env', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const notifications = [];
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'impl', settle: true }),
    () => ({ assistantText: 'not json', settle: true }), // invalid verdict -> block
  ]);
  const baseRun = makeFakeRun(gitGhHandlers(state));
  const run = (cmd, opts) => {
    if (opts && opts.env && opts.env.COORD_EVENT) {
      notifications.push({ event: opts.env.COORD_EVENT, ticket: opts.env.COORD_BLOCKED_TICKET });
      return ok('');
    }
    return baseRun(cmd, opts);
  };
  const cfg = baseConfig({ notify: { on: ['blocked', 'done'], command: 'send-it' } });
  const coord = makeCoord(root, cfg, { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.deepEqual(notifications, [{ event: 'blocked', ticket: '6' }]);
});

test('notify respects the `on` allowlist (done disabled)', async () => {
  const root = tmpRoot();
  const state = { diff: 'seed' };
  const notifications = [];
  const spawn = makeFakeSpawn([
    () => ({ assistantText: 'done', settle: true }),
    () => ({ assistantText: '{"verdict":"accept","findings":[]}', settle: true }),
  ]);
  const baseRun = makeFakeRun(gitGhHandlers(state));
  const run = (cmd, opts) => {
    if (opts && opts.env && opts.env.COORD_EVENT) { notifications.push(opts.env.COORD_EVENT); return ok(''); }
    return baseRun(cmd, opts);
  };
  const cfg = baseConfig({ notify: { on: ['blocked'], command: 'send-it' } });
  const coord = makeCoord(root, cfg, { run, spawn });
  coord.startRun([6]);
  await coord.run();
  assert.deepEqual(notifications, []); // done not in allowlist, no block happened
});
