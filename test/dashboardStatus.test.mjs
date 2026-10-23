import test from 'node:test';
import assert from 'node:assert/strict';
import { getDataStatus } from '../docs/status.mjs';

test('reports collection failure instead of normal', () => {
  assert.equal(getDataStatus({ status: 'error', updatedAt: '2026-10-20T00:00:00.000Z' }, '2026-10-20T01:00:00.000Z').kind, 'error');
});

test('reports successful data older than 18 hours as stale', () => {
  const result = getDataStatus({ status: 'ok', updatedAt: '2026-10-20T00:00:00.000Z' }, '2026-10-20T18:00:01.000Z');
  assert.equal(result.kind, 'stale');
});

test('keeps recent successful data normal', () => {
  const result = getDataStatus({ status: 'ok', updatedAt: '2026-10-20T00:00:00.000Z' }, '2026-10-20T17:59:59.000Z');
  assert.equal(result.kind, 'ok');
});
