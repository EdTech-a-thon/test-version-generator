#!/usr/bin/env node
// The coordinator owns execution, evidence, recovery and publication. Agents
// implement and review one ticket at a time in a retained isolated worktree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PiSession } from './coordinator-session.mjs';
import { runCommand, stopCommands, checked, snapshot, acquireLock, selectChecks, failureKind, writeJson } from './coordinator-runtime.mjs';
import {
  buildImplementationPrompt, buildRepairFromVerify, buildRepairFromReview,
  buildReviewPrompt, buildReReviewPrompt, parseReviewVerdict, parseImplementationResult,
} from './coordinator-prompts.mjs';
export { buildImplementationPrompt, buildRepairFromVerify, buildRepairFromReview,
  buildReviewPrompt, buildReReviewPrompt, parseReviewVerdict } from './coordinator-prompts.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mkdir = directory => fs.mkdirSync(directory, { recursive: true });

export function validateConfig(config) {
  if (!config || typeof config.branch !== 'string' || !config.branch || config.branch.startsWith('-')) throw new Error('config.branch is required');
  for (const role of ['implementation', 'review']) {
    if (!config[role]?.provider || !config[role]?.model) throw new Error(`config.${role} requires provider and model`);
  }
  for (const key of ['maxRepairCycles', 'maxAgentTurns', 'maxProtocolErrors', 'maxEnvironmentRetries', 'commandTimeoutMs', 'agentTimeoutMs']) {
    if (config[key] != null && (!Number.isSafeInteger(config[key]) || config[key] < (key.startsWith('max') ? 0 : 1))) throw new Error(`Invalid ${key}`);
  }
  const commandList = commands => Array.isArray(commands) && commands.every(c =>
    typeof c === 'string' ? c.trim().length > 0 : Array.isArray(c) && c.length > 0 && c.every(a => typeof a === 'string'));
  if (config.verification) {
    if (!commandList(config.verification.quick) || !commandList(config.verification.full) || !config.verification.full.length) throw new Error('verification.quick and nonempty verification.full are required');
    if (config.verification.browserCommand && (!Array.isArray(config.verification.browserCommand) || !commandList([config.verification.browserCommand]))) throw new Error('browserCommand must be an argument array');
    for (const r of [...config.verification.affected || [], ...config.verification.required || []]) {
      if (typeof r.match !== 'string' || !r.match) throw new Error('Verification rules require a nonempty match expression');
      new RegExp(r.match);
      if (r.commands && !commandList(r.commands)) throw new Error('Invalid verification rule commands');
    }
  } else if (!commandList(config.verify) || !config.verify.length) throw new Error('Verification commands are required');
  if (config.setup && !commandList(config.setup)) throw new Error('Invalid setup commands');
  return config;
}

export class Coordinator {
  constructor({ deps = {}, config, options = {}, root }) {
    this.root = path.resolve(root);
    this.config = config == null ? null : validateConfig(config);
    this.options = options;
    this.deps = { run: runCommand, spawn, Session: PiSession, log: console.log, ...deps };
    this.coordDir = path.join(this.root, '.coordinator');
    this.pointerFile = path.join(this.coordDir, 'current-run.json');
    this.sessions = new Map();
  }

  command(command, options = {}) {
    return this.deps.run(command, { cwd: this.workDir || this.root, timeoutMs: this.config.commandTimeoutMs || 600_000, ...options });
  }
  async git(args, cwd = this.workDir || this.root, options = {}) {
    return checked(this.deps.run, ['git', ...args], { cwd, timeoutMs: 60_000, ...options });
  }
  ticketDir(number = this.state.currentTicket) { return path.join(this.runDir, 'tickets', String(number)); }
  saveState() { writeJson(path.join(this.runDir, 'state.json'), this.state); }
  event(type, fields = {}) {
    const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), runId: this.state.runId,
      ticket: this.state.currentTicket, phase: this.state.ticketState?.phase, type, ...fields };
    fs.appendFileSync(path.join(this.runDir, 'events.jsonl'), JSON.stringify(entry) + '\n');
  }
  transition(phase) {
    this.state.ticketState.phase = phase;
    this.state.state = phase;
    this.saveState();
    this.event('transition', { phase });
  }

  async checkPreconditions(tickets) {
    if (!tickets?.length || tickets.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Positive ticket numbers required');
    if (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], this.root) !== this.config.branch) throw new Error(`Launch from branch ${this.config.branch}`);
    if (await this.git(['status', '--porcelain', '--untracked-files=all'], this.root)) throw new Error('Launch checkout must be clean, including untracked files');
    await this.git(['check-ignore', '.coordinator'], this.root);
    for (const n of tickets) {
      const issue = JSON.parse(await checked(this.deps.run, ['gh', 'issue', 'view', String(n), '--json', 'number,state'], { cwd: this.root, timeoutMs: 60_000 }));
      if (issue.state !== 'OPEN') throw new Error(`Issue #${n} is not open`);
    }
  }

  async startRun(tickets) {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
    this.runDir = path.join(this.coordDir, 'runs', runId);
    this.workDir = path.join(this.runDir, 'worktree');
    mkdir(this.runDir);
    this.state = { schemaVersion: 2, runId, config: this.config, tickets, accepted: [], currentTicket: tickets[0],
      state: 'setup', baseCommit: await this.git(['rev-parse', 'HEAD'], this.root),
      workDir: this.workDir, push: !!this.options.push, ticketState: null, blocked: null, setupComplete: false };
    this.saveState();
    writeJson(this.pointerFile, { runId });
    this.event('run_started');
  }

  loadRun() {
    const { runId } = readJson(this.pointerFile);
    if (typeof runId !== 'string' || path.basename(runId) !== runId) throw new Error('Invalid run pointer');
    this.runDir = path.join(this.coordDir, 'runs', runId);
    this.state = readJson(path.join(this.runDir, 'state.json'));
    if (this.state.schemaVersion !== 2) throw new Error('Legacy run cannot be safely resumed by this version. Its artifacts are preserved. Inspect outstanding changes and start an explicit new --tickets run from a clean checkout.');
    this.config = validateConfig(this.state.config);
    this.workDir = this.state.workDir;
    if (this.workDir !== path.join(this.runDir, 'worktree')) throw new Error('Invalid worktree path in run state');
    if (this.options.push) this.state.push = true;
    this.saveState();
    this.event('run_resumed');
  }

  async ensureWorktree() {
    if (!fs.existsSync(path.join(this.workDir, '.git'))) {
      await this.git(['worktree', 'add', '--detach', this.workDir, this.state.baseCommit], this.root);
    }
    if (this.state.setupComplete) return;
    mkdir(path.join(this.workDir, '.coordinator'));
    for (const command of this.config.setup || []) {
      const result = await this.loggedCommand(command, path.join(this.runDir, 'setup'), 'setup');
      if (result.code) throw new Error(`Worktree setup failed: ${result.logFile}`);
    }
    if (await this.git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Setup changed source files; inspect the isolated worktree');
    this.state.setupComplete = true;
    this.state.dependenciesKey = await this.git(['ls-tree', 'HEAD', '--', 'package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
    this.saveState();
  }

  async prepareTicket(number) {
    this.closeSessions();
    this.state.currentTicket = number;
    const tdir = this.ticketDir(number);
    mkdir(tdir);
    const issue = JSON.parse(await checked(this.deps.run, ['gh', 'issue', 'view', String(number), '--json', 'number,title,body,comments'], { cwd: this.root, timeoutMs: 60_000 }));
    const issueFile = path.join(tdir, 'issue.txt');
    fs.writeFileSync(issueFile, `#${number}: ${issue.title}\n\n${issue.body || ''}\n\n${(issue.comments || []).map(c => c.body).join('\n\n--- comment ---\n')}`);
    this.state.ticketState = { number, title: issue.title, issueFile, base: await this.git(['rev-parse', 'HEAD']),
      phase: 'implement', attempt: 0, repairCycles: 0, agentTurns: 0, protocolErrors: 0, environmentRetries: 0,
      ledger: [], reviewStarted: false, candidate: null, checkpoints: {},
      implementationSession: path.join(tdir, 'implementation', 'session.jsonl'),
      reviewSession: path.join(tdir, 'review', 'session.jsonl') };
    this.state.blocked = null;
    this.transition('implement');
  }

  async capture() {
    const t = this.state.ticketState;
    if (await this.git(['rev-parse', 'HEAD']) !== t.base) throw new Error('Worker HEAD moved outside coordinator publication');
    return snapshot(this.deps.run, this.workDir, path.join(this.ticketDir(), 'snapshots'), t.base);
  }

  session(role) {
    if (this.sessions.has(role)) return this.sessions.get(role);
    const t = this.state.ticketState;
    const sessionFile = role === 'implementation' ? t.implementationSession : t.reviewSession;
    const instance = new this.deps.Session(this.deps, {
      agentCfg: this.config[role], sessionFile, sessionDir: path.dirname(sessionFile),
      rpcLogPath: path.join(path.dirname(sessionFile), 'rpc.log'), cwd: this.workDir,
      name: `${role}-${t.number}`, timeoutMs: this.config.agentTimeoutMs || 1_800_000,
      skillPaths: [this.config.skills?.[role === 'implementation' ? 'implement' : 'review'], ...(this.config.skills?.extra || [])]
        .filter(Boolean).map(p => path.resolve(this.workDir, p)),
      onEvent: ev => {
        if (ev.type === 'message_end' && ev.message?.role === 'assistant' && ev.message.usage) {
          this.event('usage', { role, sessionFile, usage: ev.message.usage });
        }
      },
    });
    instance.start();
    this.sessions.set(role, instance);
    return instance;
  }

  closeSessions() {
    for (const session of this.sessions.values()) session.stop({ force: true });
    this.sessions.clear();
  }

  async agentTurn(role, prompt, parser) {
    const t = this.state.ticketState;
    if (t.agentTurns >= (this.config.maxAgentTurns ?? 40)) return this.block('budget', 'Agent-turn budget exhausted; inspect the run before changing its persisted budget');
    t.agentTurns++;
    t.attempt++;
    const dir = path.join(this.ticketDir(), 'attempts', String(t.attempt).padStart(4, '0'));
    mkdir(dir);
    fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
    this.saveState();
    this.event('agent_started', { role, attempt: t.attempt, dir });
    const started = Date.now();
    const result = await this.session(role).prompt(prompt);
    fs.writeFileSync(path.join(dir, 'response.txt'), result.lastAssistantText || '');
    this.event('agent_finished', { role, attempt: t.attempt, durationMs: Date.now() - started, settled: result.settled, reason: result.reason });
    if (!result.settled) return this.block('environment', `${role} did not complete: ${result.reason || 'process exited'}`);
    let parsed = parser(result.lastAssistantText);
    if (!parsed.ok) {
      if (t.protocolErrors >= (this.config.maxProtocolErrors ?? 2)) return this.block('protocol', parsed.reason);
      t.protocolErrors++;
      this.saveState();
      // Repair output format in the same session. No implementation/test loop.
      const correction = `Your last response was not a valid current-turn result: ${parsed.reason}.\nRe-emit your result using the exact JSON schema in the preceding coordinator prompt. Preserve its candidate ID. Use your existing evidence; perform no tools, file edits, or tests. If you could not complete the work, say so rather than inventing evidence.\n`;
      parsed = await this.agentTurn(role, correction, parser);
    }
    return parsed;
  }

  async loggedCommand(command, directory, stage, candidateId) {
    mkdir(directory);
    const logFile = path.join(directory, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.log`);
    fs.writeFileSync(logFile, `$ ${JSON.stringify(command)}\n`);
    this.event('command_started', { command, stage, candidateId, logFile });
    const result = await this.command(command, { onOutput: chunk => fs.appendFileSync(logFile, chunk) });
    // Injected runners may not stream output (used in offline workflow tests).
    if (result.combined && fs.statSync(logFile).size === Buffer.byteLength(`$ ${JSON.stringify(command)}\n`)) fs.appendFileSync(logFile, result.combined);
    fs.appendFileSync(logFile, `\n(exit ${result.code})\n`);
    const flaky = [...result.combined.matchAll(/\b(\d+) flaky\b/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    this.event('command_finished', { command, stage, candidateId, logFile, code: result.code,
      durationMs: result.durationMs, timedOut: !!result.timedOut, flaky });
    return { ...result, logFile, flaky };
  }

  async verify(candidate, full) {
    const t = this.state.ticketState;
    const results = [];
    const dependenciesKey = await this.git(['ls-tree', candidate.tree, '--', 'package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
    if (dependenciesKey !== this.state.dependenciesKey) {
      for (const command of this.config.setup || []) {
        const result = await this.loggedCommand(command, path.join(this.ticketDir(), 'verify'), 'dependencies', candidate.tree);
        if (result.code) return { blocked: await this.block('environment', `Dependency setup failed: ${result.logFile}`) };
      }
      if ((await this.capture()).tree !== candidate.tree) return { changed: true };
      this.state.dependenciesKey = dependenciesKey;
      this.saveState();
    }
    for (const command of selectChecks(this.config, candidate.files, full)) {
      let result = await this.loggedCommand(command, path.join(this.ticketDir(), 'verify'), full ? 'full' : 'affected', candidate.tree);
      if (result.code && failureKind(result) === 'environment') {
        if (t.environmentRetries >= (this.config.maxEnvironmentRetries ?? 2)) return { blocked: await this.block('environment', `Infrastructure retry budget exhausted: ${result.logFile}`) };
        if ((await this.capture()).tree !== candidate.tree) return { changed: true };
        t.environmentRetries++;
        this.saveState();
        this.event('infrastructure_retry', { command, candidateId: candidate.tree });
        result = await this.loggedCommand(command, path.join(this.ticketDir(), 'verify'), 'infrastructure-retry', candidate.tree);
        if (result.code && failureKind(result) === 'environment') return { blocked: await this.block('environment', `Infrastructure failure: ${result.logFile}`) };
      }
      results.push({ command, logFile: result.logFile, code: result.code, flaky: result.flaky });
      if (result.code) return { failed: { command, output: result.combined, logFile: result.logFile } };
    }
    const verifyFile = path.join(this.ticketDir(), 'verify', `${crypto.randomUUID()}.json`);
    writeJson(verifyFile, { candidateId: candidate.tree, full, results });
    if ((await this.capture()).tree !== candidate.tree) return { changed: true };
    return { verifyFile };
  }

  async scheduleRepair(feedback) {
    const t = this.state.ticketState;
    if (t.repairCycles >= (this.config.maxRepairCycles ?? 5)) return this.block('budget', 'Repair budget exhausted (retained across resume)');
    t.repairCycles++;
    t.pendingRepair = feedback;
    this.transition('repair');
    return true;
  }

  async reviewCandidate(candidate, verifyFile) {
    const t = this.state.ticketState;
    const directory = path.join(this.ticketDir(), 'review', `candidate-${t.attempt + 1}-${candidate.tree.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`);
    mkdir(directory);
    const manifestFile = path.join(directory, 'manifest.json');
    const diffFile = path.join(directory, 'diff.txt');
    const ledgerFile = path.join(this.ticketDir(), 'findings.json');
    writeJson(manifestFile, { candidateId: candidate.tree, baseCommit: t.base, files: candidate.files });
    writeJson(ledgerFile, t.ledger);
    const diff = await this.command(['git', 'diff', '--binary', t.base, candidate.tree, '--'], { onOutput: chunk => fs.appendFileSync(diffFile, chunk) });
    if (diff.code) throw new Error('Could not generate candidate diff');
    if (!fs.existsSync(diffFile)) fs.writeFileSync(diffFile, diff.stdout);
    const args = { number: t.number, issueFile: t.issueFile, baseCommit: t.base, candidateId: candidate.tree,
      manifestFile, diffFile, verifyFile, ledgerFile };
    const prompt = t.reviewStarted ? buildReReviewPrompt(args) : buildReviewPrompt(args);
    t.reviewStarted = true;
    this.saveState();
    const verdict = await this.agentTurn('review', prompt, text => parseReviewVerdict(text, candidate.tree));
    if (!verdict || verdict === 'blocked') return 'blocked';
    writeJson(path.join(directory, 'verdict.json'), verdict);
    if ((await this.capture()).tree !== candidate.tree) return this.block('integrity', 'Candidate changed during read-only review; inspect worktree and review session');
    const open = t.ledger.filter(f => f.status === 'open');
    const resolved = new Set(verdict.resolvedFindingIds);
    if ([...resolved].some(id => !open.some(f => f.id === id)) ||
        open.some(f => !resolved.has(f.id) && !verdict.findings.some(n => n.id === f.id)) ||
        verdict.findings.some(f => resolved.has(f.id))) return this.block('protocol', 'Review did not account for outstanding finding IDs consistently');
    for (const f of t.ledger) if (resolved.has(f.id)) f.status = 'resolved';
    for (const f of verdict.findings) {
      const prior = t.ledger.find(p => p.id === f.id);
      if (prior) Object.assign(prior, f, { status: 'open', lastCandidate: candidate.tree });
      else t.ledger.push({ ...f, status: 'open', firstCandidate: candidate.tree, lastCandidate: candidate.tree });
    }
    writeJson(ledgerFile, t.ledger);
    this.event('review_verdict', { candidateId: candidate.tree, verdict: verdict.verdict, findings: verdict.findings, resolvedFindingIds: verdict.resolvedFindingIds });
    this.saveState();
    if (verdict.verdict === 'accept') return 'accept';
    const signature = JSON.stringify(verdict.findings.map(f => f.id).sort());
    if (t.lastRejectedTree === candidate.tree && t.lastFindings === signature) return this.block('no-progress', 'Same candidate and unresolved findings returned after repair');
    t.lastRejectedTree = candidate.tree;
    t.lastFindings = signature;
    return this.scheduleRepair({ type: 'review', report: JSON.stringify(verdict), ledgerFile });
  }

  async runTicket() {
    const t = this.state.ticketState;
    while (t.phase !== 'accepted') {
      this.state.blocked = null;
      this.state.state = t.phase;
      this.saveState();
      if (t.phase === 'implement' || t.phase === 'repair') {
        const feedback = t.pendingRepair;
        const prompt = t.phase === 'implement' ? buildImplementationPrompt({ number: t.number, issueFile: t.issueFile })
          : feedback.type === 'review' ? buildRepairFromReview(feedback) : buildRepairFromVerify({ ...feedback, command: JSON.stringify(feedback.command) });
        const result = await this.agentTurn('implementation', prompt, parseImplementationResult);
        if (!result || result === 'blocked') return 'blocked';
        if (result.status === 'blocked') return this.block(result.kind, result.reason);
        t.handoff = result;
        t.pendingRepair = null;
        this.transition('quick-verify');
      } else if (t.phase === 'quick-verify') {
        const candidate = await this.capture();
        const checks = await this.verify(candidate, false);
        if (checks.blocked) return 'blocked';
        if (checks.changed) return this.block('integrity', 'Verification changed the candidate; inspect generated source changes');
        if (checks.failed) {
          if (await this.scheduleRepair({ type: 'verification', ...checks.failed }) === 'blocked') return 'blocked';
          continue;
        }
        t.candidate = candidate;
        t.verifyFile = checks.verifyFile;
        this.transition('review');
      } else if (t.phase === 'review') {
        if ((await this.capture()).tree !== t.candidate.tree) { this.transition('quick-verify'); continue; }
        const outcome = await this.reviewCandidate(t.candidate, t.verifyFile);
        if (outcome === 'blocked') return 'blocked';
        if (outcome === 'accept') {
          t.reviewedTree = t.candidate.tree;
          this.transition('full-verify');
        }
      } else if (t.phase === 'full-verify') {
        if ((await this.capture()).tree !== t.reviewedTree) { this.transition('quick-verify'); continue; }
        const checks = await this.verify(t.candidate, true);
        if (checks.blocked) return 'blocked';
        if (checks.changed) return this.block('integrity', 'Candidate changed during final verification');
        if (checks.failed) {
          if (await this.scheduleRepair({ type: 'verification', ...checks.failed }) === 'blocked') return 'blocked';
          continue;
        }
        t.fullVerifyFile = checks.verifyFile;
        t.verifiedTree = t.candidate.tree;
        this.transition('publish');
      } else if (t.phase === 'publish') {
        if (await this.publish() === 'blocked') return 'blocked';
      } else throw new Error(`Unknown ticket phase ${t.phase}`);
    }
    return 'accepted';
  }

  async publish() {
    const t = this.state.ticketState;
    const cp = t.checkpoints;
    if (!cp.commit) {
      const candidate = await this.capture();
      if (candidate.tree !== t.reviewedTree || candidate.tree !== t.verifiedTree) {
        this.transition('quick-verify');
        return 'changed';
      }
      const messageFile = path.join(this.ticketDir(), 'commit-message.txt');
      fs.writeFileSync(messageFile, `Implement #${t.number}: ${t.title}\n`);
      // Commit exactly the verified tree. No shell interpolation, live-index
      // staging, or hooks that can modify the candidate after its review.
      cp.commit = await this.git(['commit-tree', candidate.tree, '-p', t.base, '-F', messageFile]);
      this.saveState();
      this.event('committed', { commit: cp.commit, candidateId: candidate.tree });
    }
    // Reconcile each side effect with Git on resume, including a crash between
    // the operation and its state write. Anchor the commit before integration.
    await this.git(['update-ref', `refs/coordinator/${this.state.runId}/${t.number}`, cp.commit]);
    const workerHead = await this.git(['rev-parse', 'HEAD']);
    if (workerHead !== t.base && workerHead !== cp.commit) return this.block('integrity', 'Worker HEAD diverged before publication');
    const current = await snapshot(this.deps.run, this.workDir, path.join(this.ticketDir(), 'snapshots'), t.base);
    if (current.tree !== t.verifiedTree) return this.block('integrity', 'Worktree changed after commit checkpoint');
    if (workerHead !== cp.commit) {
      await this.git(['update-ref', 'HEAD', cp.commit, t.base]);
    }
    // A crash can happen after moving HEAD but before synchronizing the index.
    await this.git(['read-tree', cp.commit]);
    if (!cp.integrated) {
      if (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], this.root) !== this.config.branch) return this.block('integration', 'Launch checkout is on another branch');
      if (await this.git(['status', '--porcelain', '--untracked-files=all'], this.root)) return this.block('integration', 'Launch checkout has user changes; clean or preserve them before resume');
      const head = await this.git(['rev-parse', 'HEAD'], this.root);
      if (head !== cp.commit) {
        if (head !== t.base) return this.block('integration', 'Launch branch moved; reconcile it with the retained coordinator commit before resume');
        await this.git(['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', cp.commit], this.root);
      }
      cp.integrated = true;
      this.saveState();
      this.event('integrated', { commit: cp.commit });
    }
    if (this.state.push && !cp.pushed) {
      const result = await this.command(['git', 'push', 'origin', `${cp.commit}:refs/heads/${this.config.branch}`]);
      if (result.code) return this.block('publication', `Push failed: ${result.combined}`);
      cp.pushed = true;
      this.saveState();
      this.event('pushed', { commit: cp.commit });
    }
    if (this.state.push && !cp.closed) {
      const issue = await this.command(['gh', 'issue', 'view', String(t.number), '--json', 'state']);
      if (issue.code) return this.block('publication', `Cannot inspect issue before close: ${issue.combined}`);
      if (JSON.parse(issue.stdout).state !== 'CLOSED') {
        const result = await this.command(['gh', 'issue', 'close', String(t.number), '--comment', `Implemented and verified by coordinator (${cp.commit}). Evidence: run ${this.state.runId}.`]);
        if (result.code) return this.block('publication', `Issue close failed: ${result.combined}`);
      }
      cp.closed = true;
      this.saveState();
      this.event('issue_closed');
    }
    if (!this.state.accepted.includes(t.number)) this.state.accepted.push(t.number);
    this.state.blocked = null;
    this.transition('accepted');
    this.closeSessions();
    return 'accepted';
  }

  async block(kind, reason) {
    this.state.blocked = { ticket: this.state.currentTicket, kind, reason, phase: this.state.ticketState?.phase, at: new Date().toISOString() };
    this.state.state = 'blocked';
    this.saveState();
    this.event('blocked', this.state.blocked);
    this.deps.log(`BLOCKED #${this.state.currentTicket} [${kind}]: ${reason}`);
    this.closeSessions();
    await this.notify('blocked');
    return 'blocked';
  }

  async notify(event) {
    const summary = { event, runId: this.state.runId, accepted: this.state.accepted, blocked: this.state.blocked,
      workDir: this.workDir, ticketDir: this.ticketDir(), sessionFiles: this.state.ticketState && {
        implementation: this.state.ticketState.implementationSession, review: this.state.ticketState.reviewSession },
      findings: this.state.ticketState?.ledger.filter(f => f.status === 'open') || [] };
    const summaryFile = path.join(this.runDir, `NOTIFY-${event}.txt`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
    const cfg = this.config.notify;
    if (!cfg?.command || !(cfg.on || ['blocked', 'done']).includes(event)) return;
    const result = await this.command(cfg.command, { cwd: this.root, timeoutMs: 30_000, env: {
      COORD_EVENT: event, COORD_RUN_ID: this.state.runId, COORD_RUN_DIR: this.runDir,
      COORD_SUMMARY_FILE: summaryFile, COORD_SUMMARY: JSON.stringify(summary),
      COORD_BLOCKED_TICKET: this.state.blocked ? String(this.state.currentTicket) : '', COORD_ACCEPTED: this.state.accepted.join(','),
    } });
    this.event('notification', { event, code: result.code });
    if (result.code) this.deps.log(`Notification failed; summary retained at ${summaryFile}`);
  }

  async run() {
    const heartbeat = setInterval(() => writeJson(path.join(this.runDir, 'heartbeat.json'), {
      pid: process.pid, at: new Date().toISOString(), state: this.state.state, ticket: this.state.currentTicket,
    }), 15_000);
    try {
      await this.ensureWorktree();
      for (const number of this.state.tickets) {
        if (this.state.accepted.includes(number)) continue;
        if (this.state.ticketState?.number !== number) await this.prepareTicket(number);
        if (await this.runTicket() === 'blocked') return 'blocked';
      }
      this.state.state = 'done';
      this.state.blocked = null;
      this.saveState();
      this.event('done');
      if (!this.state.doneNotified) {
        await this.notify('done');
        this.state.doneNotified = true;
        this.saveState();
      }
      return 'done';
    } catch (error) {
      return await this.block('coordinator', error.message);
    } finally {
      clearInterval(heartbeat);
      this.closeSessions();
    }
  }
}

export function parseArgs(argv) {
  const options = { tickets: null, resume: false, push: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tickets') {
      const value = argv[++i];
      if (!value || !/^\d+(,\d+)*$/.test(value)) throw new Error('--tickets requires comma-separated positive integers');
      options.tickets = value.split(',').map(Number);
      if (options.tickets.some(n => !Number.isSafeInteger(n) || n <= 0) || new Set(options.tickets).size !== options.tickets.length) throw new Error('Tickets must be unique positive integers');
    } else if (argv[i] === '--resume') options.resume = true;
    else if (argv[i] === '--push') options.push = true;
    else if (argv[i] === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!options.help && (options.resume === !!options.tickets)) throw new Error('Provide either --tickets a,b or --resume');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/coordinate-tickets.mjs (--tickets 1,2 | --resume) [--push]\nCreates a retained isolated worktree. --push also pushes accepted commits and closes tickets.\nInspect with node scripts/coordinator-status.mjs. Config is frozen per run.');
    return;
  }
  const root = process.cwd();
  const coordinator = new Coordinator({ root, options, config: options.resume ? undefined : readJson(path.join(root, 'coordinator.config.json')) });
  const release = acquireLock(path.join(root, '.coordinator'));
  const signal = () => {
    coordinator.closeSessions();
    stopCommands();
    // Keep the lock on interruption: a command child may still be shutting down.
    // The operator checks the retained PID/workers before explicit recovery.
    process.exit(130);
  };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    if (options.resume) coordinator.loadRun();
    else { await coordinator.checkPreconditions(options.tickets); await coordinator.startRun(options.tickets); }
    if (await coordinator.run() === 'blocked') process.exitCode = 1;
  } finally {
    coordinator.closeSessions();
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
