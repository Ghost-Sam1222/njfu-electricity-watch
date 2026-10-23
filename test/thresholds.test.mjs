import test from 'node:test';
import assert from 'node:assert/strict';
import { detectUsageAnomaly, evaluateThreshold } from '../src/thresholds.mjs';

const lighting = {
  id: 'lighting',
  threshold: {
    dailyKwh: 4,
    anomalyMultiplier: 1.8,
    anomalyHardLimitKwh: 9,
    anomalyMinIntervalHours: 8,
    anomalyMinSamples: 7,
    relativeAnomalyEnabled: false,
    kwhBands: {
      early: 70,
      strong: 40,
      urgent: 20
    }
  }
};

test('uses 70/40/20 lighting balance bands at their boundaries', () => {
  assert.deepEqual(evaluateThreshold(lighting, { kwh: 70 })[0], {
    id: 'balance-early',
    level: 'notice',
    metric: 'kwh',
    band: 'early',
    repeatHours: 72,
    message: '剩余电量 70 度，已到达提前提醒线 70 度'
  });
  assert.equal(evaluateThreshold(lighting, { kwh: 40 })[0].band, 'strong');
  assert.equal(evaluateThreshold(lighting, { kwh: 20 })[0].band, 'urgent');
  assert.equal(evaluateThreshold(lighting, { kwh: 70.01 }).length, 0);
});

test('does not treat return from a low vacation baseline as a relative spike', () => {
  const history = usageHistory([0.2, 0.3, 0.5, 0.4, 0.6, 0.7, 0.5, 0.4]);
  const previous = history.at(-1);
  const current = {
    id: 'lighting',
    checkedAt: new Date(Date.parse(previous.checkedAt) + 24 * 36e5).toISOString(),
    metrics: { kwh: previous.kwh - 6.89 }
  };

  const result = detectUsageAnomaly(lighting, current, history);
  assert.equal(result.kind, 'usage');
  assert.equal(result.projectedDailyKwh, 6.89);
  assert.equal(result.alert, undefined);
});

test('labels short intervals as projections without raising an anomaly', () => {
  const previous = { id: 'lighting', checkedAt: '2026-10-20T00:00:00.000Z', kwh: 100 };
  const current = { id: 'lighting', checkedAt: '2026-10-20T06:00:00.000Z', metrics: { kwh: 97.5 } };
  const result = detectUsageAnomaly(lighting, current, [previous]);

  assert.equal(result.kind, 'usage');
  assert.equal(result.hours, 6);
  assert.equal(result.usageKwh, 2.5);
  assert.equal(result.projectedDailyKwh, 10);
  assert.equal(result.shortInterval, true);
  assert.equal(result.alert, undefined);
});

test('raises the lighting fixed-limit alert only above 9 kWh per 24 hours', () => {
  const previous = { id: 'lighting', checkedAt: '2026-10-20T00:00:00.000Z', kwh: 100 };
  const normal = detectUsageAnomaly(lighting, {
    id: 'lighting', checkedAt: '2026-10-21T00:00:00.000Z', metrics: { kwh: 91 }
  }, [previous]);
  const high = detectUsageAnomaly(lighting, {
    id: 'lighting', checkedAt: '2026-10-21T00:00:00.000Z', metrics: { kwh: 90.8 }
  }, [previous]);

  assert.equal(normal.alert, undefined);
  assert.match(high.alert.message, /24 小时折算/);
  assert.match(high.alert.message, /非完整一天实耗/);
});

test('keeps the legacy air-conditioning threshold behavior unchanged', () => {
  const ac = {
    id: 'ac',
    threshold: {
      kwh: 20,
      amount: 12,
      dailyKwh: 24,
      minHours: 20,
      anomalyMultiplier: 1.8,
      anomalyMinSamples: 7
    }
  };
  const alerts = evaluateThreshold(ac, { kwh: 19, amount: 11 });
  assert.deepEqual(alerts.map(alert => alert.metric), ['kwh', 'amount', 'runtime']);
  assert.equal(alerts[0].level, 'warning');
});

function usageHistory(rates) {
  const rows = [{ id: 'lighting', checkedAt: '2026-10-01T00:00:00.000Z', kwh: 120 }];
  for (const rate of rates) {
    const previous = rows.at(-1);
    rows.push({
      id: 'lighting',
      checkedAt: new Date(Date.parse(previous.checkedAt) + 24 * 36e5).toISOString(),
      kwh: previous.kwh - rate
    });
  }
  return rows;
}
