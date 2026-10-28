import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyUsage } from '../docs/usage.mjs';

const targets = [
  { id: 'lighting', expectedDailyKwh: 4, anomalyHardLimitKwh: 9, anomalyMinIntervalHours: 8, relativeAnomalyEnabled: false },
  { id: 'ac', expectedDailyKwh: 24 }
];

test('does not mark a 48-hour 12 kWh lighting interval as a 12 kWh day', () => {
  const rows = buildDailyUsage([
    { id: 'lighting', checkedAt: '2026-10-09T00:00:00.000Z', kwh: 100 },
    { id: 'lighting', checkedAt: '2026-10-11T00:00:00.000Z', kwh: 88 }
  ], targets);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].usage, 12);
  assert.equal(rows[0].hours, 48);
  assert.equal(rows[0].projectedDailyKwh, 6);
  assert.equal(rows[0].anomaly, null);
});

test('keeps short lighting usage visible without marking its projection anomalous', () => {
  const rows = buildDailyUsage([
    { id: 'lighting', checkedAt: '2026-10-09T00:00:00.000Z', kwh: 100 },
    { id: 'lighting', checkedAt: '2026-10-09T06:00:00.000Z', kwh: 97.5 }
  ], targets);

  assert.equal(rows[0].usage, 2.5);
  assert.equal(rows[0].hours, 6);
  assert.equal(rows[0].projectedDailyKwh, 10);
  assert.equal(rows[0].shortInterval, true);
  assert.equal(rows[0].anomaly, null);
});

test('still marks a trusted lighting interval above the fixed projected limit', () => {
  const rows = buildDailyUsage([
    { id: 'lighting', checkedAt: '2026-10-09T00:00:00.000Z', kwh: 100 },
    { id: 'lighting', checkedAt: '2026-10-10T00:00:00.000Z', kwh: 90.8 }
  ], targets);
  assert.match(rows[0].anomaly, /24小时折算/);
});
