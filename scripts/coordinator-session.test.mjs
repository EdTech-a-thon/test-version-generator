import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PiSession } from './coordinator-session.mjs';

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-session-'));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  const commands = [];
  const signals = [];
  child.stdin.write = (line) => commands.push(JSON.parse(line));
  child.stdin.end = () => {};
  child.kill = (signal) => signals.push(signal);
  let spawnArgs;
  const session = new PiSession({ spawn: (...args) => { spawnArgs = args; return child; } }, {
    agentCfg: { provider: 'test', model: 'test' }, sessionDir: dir,
    rpcLogPath: path.join(dir, 'rpc.log'), sessionFile: path.join(dir, 'persistent.jsonl'),
    cwd: dir, timeoutMs: 1000, ...options,
  });
  session.start();
  t.after(async () => {
    session.stop();
    if (!session.rpcLog.closed) await new Promise((resolve) => session.rpcLog.once('close', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const emit = (event) => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
  return { session, child, commands, signals, emit, spawnArgs, dir };
}

test('starts and restores a precise session path with the workspace cwd', (t) => {
  const { session, spawnArgs, dir } = fixture(t);
  assert.equal(spawnArgs[0], 'pi');
  assert.equal(spawnArgs[1][spawnArgs[1].indexOf('--session') + 1], path.join(dir, 'persistent.jsonl'));
  assert.equal(spawnArgs[2].cwd, dir);
  assert.equal(spawnArgs[2].detached, process.platform === 'linux');
  assert.equal(session.sessionFile, path.join(dir, 'persistent.jsonl'));
});

test('waits past agent_end and never reuses an earlier prompt answer', async (t) => {
  const { session, emit } = fixture(t);
  const first = session.prompt('first');
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'old verdict' }] } });
  emit({ type: 'agent_end' });
  assert.ok(session.pending);
  emit({ type: 'agent_settled' });
  assert.equal((await first).lastAssistantText, 'old verdict');
  const second = session.prompt('second');
  emit({ type: 'agent_settled' });
  assert.deepEqual(await second, { settled: true, lastAssistantText: null, reason: 'settled' });
});

test('only a rejected response for this command fails the prompt', async (t) => {
  const { session, commands, emit } = fixture(t);
  const pending = session.prompt('work');
  emit({ type: 'response', id: 'unrelated', success: false, error: 'other command' });
  assert.ok(session.pending);
  emit({ type: 'response', id: commands[0].id, success: false, error: 'invalid prompt' });
  assert.deepEqual(await pending, { settled: false, lastAssistantText: null, reason: 'prompt rejected: invalid prompt' });
});

for (const failure of ['error', 'exit', 'stdin']) {
  test(`${failure} during a prompt resolves without hanging; later prompt fails immediately`, async (t) => {
    const { session, child } = fixture(t);
    const pending = session.prompt('work');
    if (failure === 'exit') child.emit('exit', 1);
    else (failure === 'stdin' ? child.stdin : child).emit('error', new Error('broken pipe'));
    assert.equal((await pending).settled, false);
    assert.equal((await session.prompt('retry')).settled, false);
  });
}

test('process death before the first prompt is remembered', async (t) => {
  const { session, child } = fixture(t);
  child.emit('exit', 2);
  assert.match((await session.prompt('work')).reason, /exited/);
});

test('synchronous RPC write failure resolves the prompt', async (t) => {
  const { session, child } = fixture(t);
  child.stdin.write = () => { throw new Error('pipe closed'); };
  assert.match((await session.prompt('work')).reason, /write error: pipe closed/);
});

test('spawn failure resolves without requiring a child exit event', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-spawn-'));
  const session = new PiSession({ spawn: () => { throw new Error('pi missing'); } }, {
    agentCfg: { provider: 'test', model: 'test' }, sessionDir: dir, rpcLogPath: path.join(dir, 'rpc.log'),
  });
  t.after(async () => {
    session.stop();
    if (!session.rpcLog.closed) await new Promise((resolve) => session.rpcLog.once('close', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  session.start();
  assert.match((await session.prompt('work')).reason, /spawn error: pi missing/);
});

test('deadline stops the process and resolves the prompt', async (t) => {
  const { session, signals } = fixture(t, { timeoutMs: 5 });
  assert.match((await session.prompt('work')).reason, /deadline/);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(session.stopped, true);
});

test('an assistant API error cannot become a successful settled result', async (t) => {
  const { session, emit } = fixture(t);
  const pending = session.prompt('work');
  emit({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'quota exceeded' } });
  emit({ type: 'agent_settled' });
  assert.match((await pending).reason, /quota exceeded/);
});

test('usage is reported once from a completed message, never its streaming snapshots', async (t) => {
  let total = 0;
  const { session, emit } = fixture(t, { onEvent: (event) => { if (event.message?.usage) total += event.message.usage.output; } });
  const pending = session.prompt('work');
  const message = { role: 'assistant', content: [], usage: { output: 10 } };
  emit({ type: 'message_start', message });
  emit({ type: 'message_update', message });
  emit({ type: 'message_end', message });
  emit({ type: 'agent_end', messages: [message] });
  emit({ type: 'agent_settled' });
  await pending;
  assert.equal(total, 10);
});
