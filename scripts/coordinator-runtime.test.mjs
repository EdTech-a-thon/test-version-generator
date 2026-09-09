import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectChecks, failureKind } from './coordinator-runtime.mjs';
import { parseArgs, validateConfig } from './coordinate-tickets.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../coordinator.config.json', import.meta.url), 'utf8'));
const hasFull = commands => commands.some(c => JSON.stringify(c) === JSON.stringify(['bun', 'run', 'test:e2e']));

test('an affected drag change uses focused browser coverage while unknown/shared changes keep the full gate', () => {
  const selected = selectChecks(config, ['src/workspace-drag.ts']);
  assert.equal(hasFull(selected), false);
  assert.ok(selected.some(c => Array.isArray(c) && c.includes('scripts/question-bank-drag.e2e.ts')));
  assert.equal(hasFull(selectChecks(config, ['src/new-shared-thing.ts'])), true);
  assert.equal(hasFull(selectChecks(config, ['src/styles.css'])), true);
  assert.equal(hasFull(selectChecks(config, ['src/workspace-drag.ts'], true)), true);
});

test('browser-test-only edits select those files and coordinator/doc changes stay on cheap repair checks', () => {
  const selected = selectChecks(config, ['scripts/workspace-layout.e2e.ts']);
  assert.equal(hasFull(selected), false);
  assert.ok(selected.some(c => Array.isArray(c) && c.includes('scripts/workspace-layout.e2e.ts') && c.includes('--retries=0')));
  assert.equal(hasFull(selectChecks(config, ['scripts/coordinator-runtime.mjs', 'docs/browser-assertions.md'])), false);
});

test('export changes retain the required diagnostic, even in affected verification', () => {
  for (const full of [false, true]) {
    const selected = selectChecks(config, ['src/pdf-export.ts'], full);
    assert.ok(selected.some(c => Array.isArray(c) && c.includes('test:exports')));
  }
});

test('only recognizable infrastructure signals receive the environment retry policy', () => {
  assert.equal(failureKind({ timedOut: true, combined: '' }), 'environment');
  assert.equal(failureKind({ combined: 'Error: Page crashed' }), 'environment');
  assert.equal(failureKind({ combined: 'Expected button to be visible. Timeout exceeded.' }), 'verification');
});

test('CLI rejects ambiguous, duplicate and malformed ticket input', () => {
  assert.deepEqual(parseArgs(['--tickets', '7,8', '--push']), { tickets: [7, 8], resume: false, push: true });
  for (const args of [[], ['--tickets', '7oops'], ['--tickets', '7,7'], ['--tickets', '0'], ['--tickets', '7', '--resume']]) assert.throws(() => parseArgs(args));
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, agentTimeoutMs: 0 }));
});
