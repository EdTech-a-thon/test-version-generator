#!/usr/bin/env node
// Read-only status reporter for the coordinator. Touches ONLY files on disk
// under .coordinator/. No model is invoked. Use it to check in on progress
// and to read the latest reviewer feedback per ticket.
//
//   node scripts/coordinator-status.mjs            # summary of the latest run
//   node scripts/coordinator-status.mjs --run <id> # a specific run
//   node scripts/coordinator-status.mjs --ticket 6 # deep dive one ticket
//   node scripts/coordinator-status.mjs --follow   # live-refresh the summary

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coordDir = path.join(root, '.coordinator');
const runsDir = path.join(coordDir, 'runs');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function latestRunId() {
  const ptr = readJson(path.join(coordDir, 'current-run.json'));
  if (ptr && ptr.runId) return ptr.runId;
  if (!exists(runsDir)) return null;
  const runs = fs.readdirSync(runsDir).sort();
  return runs[runs.length - 1] || null;
}

function args() {
  const a = process.argv.slice(2);
  const o = { run: null, ticket: null, follow: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--run') o.run = a[++i];
    else if (a[i] === '--ticket') o.ticket = a[++i];
    else if (a[i] === '--follow') o.follow = true;
  }
  return o;
}

function latestReview(runDir, ticket) {
  const rroot = path.join(runDir, 'tickets', String(ticket), 'review');
  if (!exists(rroot)) return null;
  const cycles = fs.readdirSync(rroot).filter((d) => /^\d+$/.test(d)).sort((x, y) => +x - +y);
  if (!cycles.length) return null;
  const last = cycles[cycles.length - 1];
  const rdir = path.join(rroot, last);
  return {
    cycle: last,
    verdict: readJson(path.join(rdir, 'verdict.json')),
    response: readText(path.join(rdir, 'response.txt')),
    dir: rdir,
  };
}

function ticketDeepDive(runDir, ticket) {
  const tdir = path.join(runDir, 'tickets', String(ticket));
  console.log(`\n=== Ticket #${ticket} ===`);
  const impl = path.join(tdir, 'implementation');
  if (exists(path.join(impl, 'final.txt'))) {
    console.log(`\n-- implementation final message --`);
    console.log(readText(path.join(impl, 'final.txt')).trim().slice(0, 4000));
  }
  // latest verify log
  const vdir = path.join(tdir, 'verify');
  if (exists(vdir)) {
    const logs = fs.readdirSync(vdir).sort();
    const last = logs[logs.length - 1];
    if (last) {
      console.log(`\n-- latest verification (${last}) --`);
      console.log(readText(path.join(vdir, last)).trim().slice(0, 3000));
    }
  }
  // all review cycles
  const rroot = path.join(tdir, 'review');
  if (exists(rroot)) {
    const cycles = fs.readdirSync(rroot).filter((d) => /^\d+$/.test(d)).sort((x, y) => +x - +y);
    for (const c of cycles) {
      const v = readJson(path.join(rroot, c, 'verdict.json'));
      console.log(`\n-- review cycle ${c}: ${v ? v.verdict || 'INVALID' : '(no verdict)'} --`);
      const report = readText(path.join(rroot, c, 'response.txt'));
      if (report) {
        console.log(report.trim().slice(0, 4000));
      } else if (v && v.findings && v.findings.length) {
        v.findings.forEach((f, i) => {
          console.log(`  ${i + 1}. ${f.title || ''}`);
          if (f.evidence) console.log(`     evidence: ${f.evidence}`);
          if (f.requiredChange) console.log(`     required: ${f.requiredChange}`);
        });
      }
      if (v && !v.ok) console.log(`     (invalid verdict: ${v.reason})`);
    }
  }
  console.log(`\nArtifacts: ${tdir}`);
}

function summary(runDir, state) {
  console.log(`Run ${state.runId}  branch-target=${state.push ? 'push' : 'local-only'}`);
  console.log(`Queue: ${state.tickets.join(', ')}`);
  console.log(`Accepted: ${state.accepted && state.accepted.length ? state.accepted.join(', ') : '(none)'}`);
  console.log(`Current: #${state.currentTicket}  state=${state.state}  repairCycles=${state.repairCycles}`);
  if (state.blocked) {
    console.log(`BLOCKED #${state.blocked.ticket}: ${state.blocked.reason} (at ${state.blocked.at})`);
  }
  console.log('');
  for (const t of state.tickets) {
    const accepted = state.accepted && state.accepted.includes(t);
    const r = latestReview(runDir, t);
    let line = `  #${t}: `;
    if (accepted) line += 'accepted';
    else if (state.blocked && state.blocked.ticket === t) line += 'BLOCKED';
    else if (t === state.currentTicket) line += state.state;
    else line += 'queued';
    if (r && r.verdict) {
      const v = r.verdict.verdict || 'invalid';
      const nf = r.verdict.findings ? r.verdict.findings.length : 0;
      line += `  (last review cycle ${r.cycle}: ${v}${nf ? `, ${nf} blocker(s)` : ''})`;
    }
    console.log(line);
  }
  console.log(`\nTip: node scripts/coordinator-status.mjs --ticket <n>  for details & reviewer feedback.`);
}

function render() {
  const o = args();
  const runId = o.run || latestRunId();
  if (!runId) { console.log('No coordinator runs found.'); return o; }
  const runDir = path.join(runsDir, runId);
  const state = readJson(path.join(runDir, 'state.json'));
  if (!state) { console.log(`No state.json in run ${runId}.`); return o; }
  if (o.ticket) ticketDeepDive(runDir, o.ticket);
  else summary(runDir, state);
  return o;
}

const o = render();
if (o.follow) {
  setInterval(() => { console.clear(); render(); }, 2000);
}
