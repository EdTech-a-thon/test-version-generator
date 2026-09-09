import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';

// One process and session file per role. Only agent_settled ends a prompt:
// agent_end can precede automatic retry or compaction (Pi docs/rpc.md).
export class PiSession {
  constructor(deps, { agentCfg, sessionDir, rpcLogPath, name, skillPaths = [], cwd = process.cwd(), sessionFile, timeoutMs = 30 * 60_000, onEvent = () => {} }) {
    Object.assign(this, { deps, agentCfg, sessionDir, rpcLogPath, name, skillPaths, cwd, timeoutMs, onEvent });
    this.sessionFile = sessionFile || path.join(sessionDir, 'session.jsonl');
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.lastAssistantText = null;
    this.exited = false;
    this.stopped = false;
    this.sequence = 0;
  }

  start() {
    if (this.child) throw new Error('Session already started');
    for (const dir of [this.sessionDir, path.dirname(this.sessionFile), path.dirname(this.rpcLogPath)]) fs.mkdirSync(dir, { recursive: true });
    this.rpcLog = fs.createWriteStream(this.rpcLogPath, { flags: 'a' });
    this.rpcLog.on('error', (error) => { this.logError = error.message; });
    const args = ['--mode', 'rpc', '--session-dir', this.sessionDir, '--session', this.sessionFile,
      '--provider', this.agentCfg.provider, '--model', this.agentCfg.model,
      '--thinking', this.agentCfg.thinking || 'high', '-n', this.name || 'coordinator'];
    for (const skill of this.skillPaths) args.push('--skill', skill);
    this.detached = process.platform === 'linux';
    try {
      this.child = this.deps.spawn('pi', args, { cwd: this.cwd, detached: this.detached, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this._died(`spawn error: ${error.message}`);
      this.rpcLog.end();
      return;
    }
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
    this.child.stderr.on('data', (chunk) => this._log(`STDERR ${chunk}`));
    this.child.on('error', (error) => this._died(`process error: ${error.message}`));
    this.child.on('exit', (code, signal) => this._died(`process exited (${signal || code})`));
    this.child.stdin.on?.('error', (error) => this._died(`stdin error: ${error.message}`));
    if (this.child.exitCode != null || this.child.signalCode) this._died('process already exited');
  }

  _log(line) {
    if (this.rpcLog && !this.rpcLog.destroyed && !this.rpcLog.writableEnded) this.rpcLog.write(line);
  }

  _died(reason) {
    this.exited = true;
    this.exitReason = reason;
    this.pending?.finish(false, reason);
  }

  _onData(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this._log(line + '\n');
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      this._onEvent(event);
    }
  }

  _onEvent(event) {
    // Completed messages carry usage; streaming snapshots must not be counted.
    if (event.type !== 'message_update' && event.type !== 'message_start') {
      try { this.onEvent(event); } catch (error) { this._log(`EVENT CALLBACK ERROR ${error.message}\n`); }
    }
    if (!this.pending) return;
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      this.lastAssistantText = (event.message.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('') || null;
      this.pending.messageError = ['error', 'aborted'].includes(event.message.stopReason)
        ? event.message.errorMessage || event.message.stopReason : null;
    }
    if (event.type === 'response' && event.id === this.pending.id && event.success === false) {
      this.pending.finish(false, `prompt rejected: ${event.error || 'unknown error'}`);
    } else if (event.type === 'agent_settled') {
      const error = this.pending.messageError;
      this.pending.finish(!error, error || 'settled');
    }
  }

  prompt(message) {
    if (this.pending) throw new Error('A prompt is already active');
    this.lastAssistantText = null;
    if (!this.child || this.exited || this.stopped) return Promise.resolve({ settled: false, lastAssistantText: null, reason: this.exitReason || 'session is not running' });
    return new Promise((resolve) => {
      const id = `prompt-${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending?.finish(false, 'prompt deadline exceeded');
        this.stop();
      }, this.timeoutMs);
      this.pending = { id, finish: (settled, reason) => {
        clearTimeout(timer);
        this.pending = null;
        resolve({ settled, lastAssistantText: this.lastAssistantText, reason });
      } };
      try { this.child.stdin.write(JSON.stringify({ id, type: 'prompt', message }) + '\n'); }
      catch (error) { this._died(`write error: ${error.message}`); }
    });
  }

  stop({ force = false } = {}) {
    const kill = (signal) => {
      try {
        if (this.detached && this.child?.pid) process.kill(-this.child.pid, signal);
        else if (!this.exited) this.child?.kill(signal);
      } catch { /* Process group may already be gone. */ }
    };
    if (force) {
      clearTimeout(this.killTimer);
      kill('SIGKILL');
    }
    if (this.stopped) return;
    this.stopped = true;
    this.pending?.finish(false, 'session stopped');
    try { this.child?.stdin.end(); } catch { /* Pipe may already be closed. */ }
    if (force) { this.rpcLog?.end(); return; }
    kill('SIGTERM');
    this.killTimer = setTimeout(() => kill('SIGKILL'), 1000);
    this.rpcLog?.end();
  }
}
