import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImplementationPrompt,
  buildRepairFromReview,
  buildRepairFromVerify,
  buildReReviewPrompt,
  buildReviewPrompt,
  parseImplementationResult,
  parseReviewVerdict,
} from './coordinator-prompts.mjs';

const complete = {
  status: 'complete',
  summary: 'Implemented the ticket at the editor boundary.',
  tests: [{ command: 'bun test src/example.test.ts', result: 'passed' }],
  testQuality: 'Covers the changed public behavior with an independent assertion.',
};

const blocked = {
  status: 'blocked',
  reason: 'The existing acceptance test contradicts the ticket specification.',
  kind: 'test-conflict',
};

const accept = {
  candidateId: 'cand-42-a',
  verdict: 'accept',
  findings: [],
  resolvedFindingIds: ['F1'],
};

const reject = {
  candidateId: 'cand-42-a',
  verdict: 'reject',
  findings: [{
    id: 'F2',
    title: 'Scroll invariant is untested',
    evidence: 'The browser test never performs a wheel gesture.',
    requiredChange: 'Add a targeted wheel test and assert the dock remains pinned.',
    severity: 'high',
    criterion: 'The Question Bank remains docked while the document scrolls.',
  }],
  resolvedFindingIds: ['F1'],
};

test('parseImplementationResult accepts a complete result on the final line', () => {
  const text = [
    'I inspected the implementation and ran the targeted check.',
    '{"status":"complete","summary":"example in prose","tests":[],"testQuality":"example"}',
    JSON.stringify(complete),
  ].join('\n');
  assert.deepEqual(parseImplementationResult(text), { ok: true, ...complete });
});

test('parseImplementationResult accepts a typed blocked result', () => {
  assert.deepEqual(parseImplementationResult(`blocked\n${JSON.stringify(blocked)}`), { ok: true, ...blocked });
});

test('parseImplementationResult reads only the final non-empty line', () => {
  const response = `${JSON.stringify(complete)}\nThe run is complete.`;
  assert.equal(parseImplementationResult(response).ok, false);
});

test('parseImplementationResult rejects missing and meaningless fields', () => {
  const cases = [
    { ...complete, summary: '' },
    { ...complete, testQuality: '   ' },
    { ...complete, tests: [{ command: '', result: 'passed' }] },
    { ...complete, tests: [{ command: 'bun test', result: '' }] },
    { ...complete, tests: 'passed' },
    { status: 'complete', summary: 'x', tests: [], testQuality: 'x', extra: true },
  ];
  for (const value of cases) assert.equal(parseImplementationResult(JSON.stringify(value)).ok, false);
});

test('parseImplementationResult rejects unknown status and invalid blocked kinds', () => {
  assert.equal(parseImplementationResult(JSON.stringify({ status: 'done' })).ok, false);
  assert.equal(parseImplementationResult(JSON.stringify({ ...blocked, kind: 'unknown' })).ok, false);
  assert.equal(parseImplementationResult(JSON.stringify({ ...blocked, reason: '' })).ok, false);
});

test('parseReviewVerdict accepts candidate-bound accept and reject results', () => {
  assert.deepEqual(parseReviewVerdict(JSON.stringify(accept), 'cand-42-a'), { ok: true, ...accept });
  assert.deepEqual(parseReviewVerdict(JSON.stringify(reject), 'cand-42-a'), { ok: true, ...reject });
});

test('parseReviewVerdict rejects prose examples, mismatched candidates, and bad verdict cardinality', () => {
  assert.equal(parseReviewVerdict('Example: {"candidateId":"cand-42-a","verdict":"accept","findings":[],"resolvedFindingIds":[]}\nNo JSON here.', 'cand-42-a').ok, false);
  assert.equal(parseReviewVerdict(JSON.stringify(accept), 'other-candidate').ok, false);
  assert.equal(parseReviewVerdict(JSON.stringify({ ...accept, findings: reject.findings, verdict: 'accept' }), 'cand-42-a').ok, false);
  assert.equal(parseReviewVerdict(JSON.stringify({ ...accept, verdict: 'reject' }), 'cand-42-a').ok, false);
});

test('parseReviewVerdict validates finding fields, severity, and unique IDs', () => {
  const badFinding = { ...reject, findings: [{ ...reject.findings[0], severity: 'low' }] };
  assert.equal(parseReviewVerdict(JSON.stringify(badFinding), 'cand-42-a').ok, false);
  const duplicate = {
    ...reject,
    findings: [reject.findings[0], { ...reject.findings[0], title: 'second' }],
  };
  assert.equal(parseReviewVerdict(JSON.stringify(duplicate), 'cand-42-a').ok, false);
  assert.equal(parseReviewVerdict(JSON.stringify({ ...accept, resolvedFindingIds: ['F1', 'F1'] }), 'cand-42-a').ok, false);
  assert.equal(parseReviewVerdict(JSON.stringify({ ...reject, findings: [{ ...reject.findings[0], criterion: '' }] }), 'cand-42-a').ok, false);
});

test('implementation prompt delegates full verification and records typed outcomes', () => {
  const prompt = buildImplementationPrompt({ number: 42, issueFile: '/run/tickets/42/issue.txt' });
  assert.match(prompt, /\/skill:implement/);
  assert.match(prompt, /targeted checks/);
  assert.match(prompt, /full verification suite/);
  assert.match(prompt, /docs\/browser-assertions\.md/);
  assert.match(prompt, /Do not commit, push, close issues/);
  assert.match(prompt, /"status":"complete"/);
  assert.match(prompt, /"status":"blocked"/);
});

test('repair prompts preserve logs, ledger, and targeted-agent boundaries', () => {
  const verify = buildRepairFromVerify({ command: 'bun run test:e2e', output: 'failure', logFile: '/run/verify/1.log' });
  assert.match(verify, /bun run test:e2e/);
  assert.match(verify, /\/run\/verify\/1\.log/);
  assert.match(verify, /coordinator owns the full verification suite/);
  const review = buildRepairFromReview({ report: 'F2 remains unresolved', ledgerFile: '/run/finding-ledger.json' });
  assert.match(review, /\/run\/finding-ledger\.json/);
  assert.match(review, /finding IDs/);
  assert.match(review, /F2 remains unresolved/);
});

test('review prompts inspect captured snapshots including new files', () => {
  const args = {
    number: 42,
    issueFile: '/run/issue.txt',
    baseCommit: 'abc1234',
    candidateId: 'cand-42-a',
    manifestFile: '/run/manifest.json',
    diffFile: '/run/worktree.diff',
    verifyFile: '/run/verify.log',
    ledgerFile: '/run/ledger.json',
  };
  const prompt = buildReviewPrompt(args);
  assert.match(prompt, /\/skill:code-review/);
  assert.match(prompt, /captured candidate manifest/i);
  assert.match(prompt, /new\/untracked files/);
  assert.match(prompt, /do not use base\.\.\.HEAD as the complete review input/i);
  assert.match(prompt, /Standards and Spec/);
  assert.match(prompt, /read-only/);
  assert.match(prompt, /docs\/browser-assertions\.md/);
  assert.match(prompt, /candidateId/);
  assert.match(prompt, /resolvedFindingIds/);
  assert.match(prompt, /start nested agents/i);
});

test('re-review prompt carries the ledger convergence contract', () => {
  const prompt = buildReReviewPrompt({
    number: 42,
    issueFile: '/run/issue.txt',
    baseCommit: 'abc1234',
    candidateId: 'cand-42-b',
    manifestFile: '/run/manifest.json',
    diffFile: '/run/worktree.diff',
    verifyFile: '/run/verify.log',
    ledgerFile: '/run/ledger.json',
  });
  assert.match(prompt, /re-review/i);
  assert.match(prompt, /resolvedFindingIds/);
  assert.match(prompt, /real regression|serious unmet acceptance criterion/i);
  assert.match(prompt, /optional style issues/);
  assert.match(prompt, /candidateId "cand-42-b"/);
});
