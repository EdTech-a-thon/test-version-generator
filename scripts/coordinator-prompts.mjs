// Prompt contracts and strict machine-result parsers for the ticket
// coordinator. The coordinator owns verification, review dispatch, commits,
// and progression; agents only implement or inspect the candidate.

const MAX_FEEDBACK_CHARS = 6000;

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function truncate(text, max = MAX_FEEDBACK_CHARS) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const head = Math.floor(max * 0.6);
  const tail = Math.floor(max * 0.3);
  return `${value.slice(0, head)}\n\n...[truncated ${value.length - head - tail} chars; full log on disk]...\n\n${value.slice(-tail)}`;
}

function promptArgs(args, fields) {
  for (const field of fields) requireText(args?.[field], field);
}

function finalJsonLine(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'empty agent response' };
  }
  const line = text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).at(-1);
  if (!line) return { ok: false, reason: 'empty agent response' };
  let value;
  try { value = JSON.parse(line); } catch { return { ok: false, reason: 'last non-empty line is not valid JSON' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'result must be a JSON object' };
  }
  return { ok: true, value };
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return { ok: false, reason: `${label} has unexpected or missing fields` };
  }
  return { ok: true };
}

function nonEmptyString(value, field) {
  return typeof value === 'string' && value.trim() !== ''
    ? null
    : `${field} must be a non-empty string`;
}

/**
 * Parse the implementation agent's final machine result. Only the final
 * non-empty line is eligible; examples or JSON-looking prose earlier in the
 * response are intentionally ignored.
 */
export function parseImplementationResult(text) {
  const parsed = finalJsonLine(text);
  if (!parsed.ok) return parsed;
  const value = parsed.value;

  if (value.status === 'complete') {
    const keys = exactKeys(value, ['status', 'summary', 'tests', 'testQuality'], 'complete result');
    if (!keys.ok) return keys;
    for (const field of ['summary', 'testQuality']) {
      const error = nonEmptyString(value[field], field);
      if (error) return { ok: false, reason: error };
    }
    if (!Array.isArray(value.tests)) return { ok: false, reason: 'tests must be an array' };
    for (let i = 0; i < value.tests.length; i++) {
      const test = value.tests[i];
      if (!test || typeof test !== 'object' || Array.isArray(test)) {
        return { ok: false, reason: `tests[${i}] must be an object` };
      }
      const shape = exactKeys(test, ['command', 'result'], `tests[${i}]`);
      if (!shape.ok) return shape;
      for (const field of ['command', 'result']) {
        const error = nonEmptyString(test[field], `tests[${i}].${field}`);
        if (error) return { ok: false, reason: error };
      }
    }
    return { ok: true, ...value };
  }

  if (value.status === 'blocked') {
    const keys = exactKeys(value, ['status', 'reason', 'kind'], 'blocked result');
    if (!keys.ok) return keys;
    const reasonError = nonEmptyString(value.reason, 'reason');
    if (reasonError) return { ok: false, reason: reasonError };
    if (!['spec', 'test-conflict', 'environment'].includes(value.kind)) {
      return { ok: false, reason: 'kind must be spec, test-conflict, or environment' };
    }
    return { ok: true, ...value };
  }

  return { ok: false, reason: 'status must be complete or blocked' };
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) return { ok: false, reason: `${field} must be an array` };
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const error = nonEmptyString(values[i], `${field}[${i}]`);
    if (error) return { ok: false, reason: error };
    if (seen.has(values[i])) return { ok: false, reason: `${field} must contain unique IDs` };
    seen.add(values[i]);
  }
  return { ok: true };
}

/** Parse a reviewer result whose candidate identity must match this snapshot. */
export function parseReviewVerdict(text, expectedCandidateId) {
  const candidateError = nonEmptyString(expectedCandidateId, 'expectedCandidateId');
  if (candidateError) return { ok: false, reason: candidateError };
  const parsed = finalJsonLine(text);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const shape = exactKeys(value, [
    'candidateId', 'verdict', 'findings', 'resolvedFindingIds',
  ], 'review result');
  if (!shape.ok) return shape;
  if (value.candidateId !== expectedCandidateId) {
    return { ok: false, reason: 'candidateId does not match the reviewed snapshot' };
  }
  if (value.verdict !== 'accept' && value.verdict !== 'reject') {
    return { ok: false, reason: 'verdict must be accept or reject' };
  }
  if (!Array.isArray(value.findings)) return { ok: false, reason: 'findings must be an array' };
  const findingIds = new Set();
  for (let i = 0; i < value.findings.length; i++) {
    const finding = value.findings[i];
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      return { ok: false, reason: `findings[${i}] must be an object` };
    }
    const findingShape = exactKeys(finding, [
      'id', 'title', 'evidence', 'requiredChange', 'severity', 'criterion',
    ], `findings[${i}]`);
    if (!findingShape.ok) return findingShape;
    for (const field of ['id', 'title', 'evidence', 'requiredChange', 'criterion']) {
      const error = nonEmptyString(finding[field], `findings[${i}].${field}`);
      if (error) return { ok: false, reason: error };
    }
    if (!['high', 'medium'].includes(finding.severity)) {
      return { ok: false, reason: `findings[${i}].severity must be high or medium` };
    }
    if (findingIds.has(finding.id)) return { ok: false, reason: 'finding IDs must be unique' };
    findingIds.add(finding.id);
  }
  const resolved = uniqueStrings(value.resolvedFindingIds, 'resolvedFindingIds');
  if (!resolved.ok) return resolved;
  if (value.verdict === 'accept' && value.findings.length !== 0) {
    return { ok: false, reason: 'accept verdict must have an empty findings array' };
  }
  if (value.verdict === 'reject' && value.findings.length === 0) {
    return { ok: false, reason: 'reject verdict must have at least one finding' };
  }
  return { ok: true, ...value };
}

export function buildImplementationPrompt({ number, issueFile }) {
  promptArgs({ number: number == null ? '' : String(number), issueFile }, ['number', 'issueFile']);
  return [
    '/skill:implement',
    '',
    `Work item: GitHub ticket #${number}. The complete issue text is saved at: ${issueFile}.`,
    'Read AGENTS.md and CONTEXT.md before changing code.',
    '',
    'Coordinator contract overrides the implement skill\'s final housekeeping instructions:',
    `- Implement only ticket #${number}; keep the change within its acceptance criteria.`,
    '- Do not commit, push, close issues, send external messages, or start subagents.',
    '- The coordinator owns the full verification suite, review dispatch, commit, and ticket progression; run targeted checks only. For a bug fix, leave red evidence before the fix where practical and keep the regression assertion.',
    '- For browser changes, read docs/browser-assertions.md and add a user-visible behavioral assertion at the appropriate boundary.',
    '- If an existing acceptance test genuinely conflicts with the specification, stop with a blocked result of kind "test-conflict".',
    '',
    'Your final non-empty line must be exactly one JSON object:',
    '{"status":"complete","summary":"...","tests":[{"command":"...","result":"..."}],"testQuality":"..."}',
    'or',
    '{"status":"blocked","reason":"...","kind":"test-conflict"}',
    'The blocked kind must be exactly one of: spec, test-conflict, environment.',
  ].join('\n');
}

export function buildRepairFromVerify({ command, output, logFile }) {
  promptArgs({ command, output: String(output ?? ''), logFile }, ['command', 'logFile']);
  return [
    'A coordinator-owned verification command failed. Continue the same implementation session and repair the underlying problem.',
    `Command: ${command}`,
    `Full verification log: ${logFile}`,
    'The excerpt below is truncated; use the repository and targeted checks to diagnose the cause.',
    'This repair contract overrides the implement skill: do not commit, push, close issues, send external messages, or start subagents.',
    'The coordinator owns the full verification suite; run targeted checks only. For browser changes, read docs/browser-assertions.md and preserve a user-visible behavioral assertion.',
    '',
    'Failure excerpt:',
    '```',
    truncate(output),
    '```',
    '',
    'Your final non-empty line must be the typed implementation result JSON from the initial prompt.',
  ].join('\n');
}

export function buildRepairFromReview({ report, ledgerFile }) {
  promptArgs({ report: String(report ?? ''), ledgerFile }, ['ledgerFile']);
  return [
    'The coordinator reviewer returned blocking findings. Continue the same implementation session and address every current finding that applies.',
    `The durable finding ledger snapshot is saved at: ${ledgerFile}. Read it to preserve finding IDs and prior resolutions; append-only lifecycle history is recorded by the coordinator in events.jsonl.`,
    'This repair contract overrides the implement skill: do not commit, push, close issues, send external messages, run a review yourself, or start subagents.',
    'The coordinator owns the full verification suite; run targeted checks only. For browser changes, read docs/browser-assertions.md and add or preserve a user-visible behavioral assertion.',
    '',
    'Reviewer report (truncated; the full report is in the review artifact):',
    '```',
    truncate(report),
    '```',
    '',
    'Your final non-empty line must be the typed implementation result JSON from the initial prompt.',
  ].join('\n');
}

function reviewContract({ number, issueFile, baseCommit, candidateId, manifestFile, diffFile, verifyFile, ledgerFile }) {
  promptArgs({ number: number == null ? '' : String(number), issueFile, baseCommit, candidateId, manifestFile, diffFile, verifyFile, ledgerFile }, [
    'number', 'issueFile', 'baseCommit', 'candidateId', 'manifestFile', 'diffFile', 'verifyFile', 'ledgerFile',
  ]);
  return [
    `/skill:code-review`,
    '',
    `Review ticket #${number}. The issue/spec is captured at: ${issueFile}.`,
    `Candidate identity: ${candidateId}.`,
    `Captured candidate manifest (includes new/untracked files): ${manifestFile}.`,
    `Captured worktree diff and file contents: ${diffFile}.`,
    `Coordinator verification record: ${verifyFile}.`,
    `Durable finding ledger snapshot: ${ledgerFile}; coordinator lifecycle events are append-only in events.jsonl.`,
    `The historical base commit is ${baseCommit}, but do not use base...HEAD as the complete review input: inspect the captured snapshot/worktree diff and manifest, including new files that a commit-range diff may omit.`,
    '',
    'Review contract overrides the code-review skill: inspect read-only. Do not edit files, commit, push, close issues, send external messages, or start nested agents.',
    'Do not run the coordinator\'s full verification suite. If validation is needed, use only targeted, read-only checks for the changed seam.',
    'Apply both Standards and Spec axes locally. Treat style and optional cleanup as nonblocking. Treat only unmet acceptance criteria, incorrect behavior/regressions, missing coverage for risky behavior, weakened tests, or material maintainability defects as blockers.',
    'For browser changes, read docs/browser-assertions.md and judge whether assertions exercise user-visible behavior at the correct boundary.',
  ];
}

function verdictContract(candidateId, reReview = false) {
  return [
    '',
    reReview
      ? 'Re-review prior findings from the durable ledger one by one. Mark resolvedFindingIds for findings actually resolved. Raise a new finding only for a real regression or a serious unmet acceptance criterion supported by current evidence; do not hunt for optional style issues.'
      : 'Record each blocking finding with a stable ID so a later repair can be checked directly.',
    `Your final non-empty line must be exactly one JSON object with candidateId "${candidateId}":`,
    '{"candidateId":"...","verdict":"accept","findings":[],"resolvedFindingIds":[]}',
    'or',
    '{"candidateId":"...","verdict":"reject","findings":[{"id":"F1","title":"...","evidence":"...","requiredChange":"...","severity":"high","criterion":"..."}],"resolvedFindingIds":[]}',
    'Finding severity must be exactly high or medium.',
    'The JSON must be the last non-empty line and must reflect the report above.',
  ];
}

export function buildReviewPrompt(args) {
  return [...reviewContract(args), ...verdictContract(args.candidateId)].join('\n');
}

export function buildReReviewPrompt(args) {
  return [
    ...reviewContract(args),
    '',
    'This is a re-review in the same reviewer session after an implementation repair.',
    ...verdictContract(args.candidateId, true),
  ].join('\n');
}
