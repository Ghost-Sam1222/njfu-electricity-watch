import test from 'node:test';
import assert from 'node:assert/strict';
import { sendBarkRequest } from '../src/bark.mjs';
import { markNotificationsSent, planNotifications } from '../src/notificationPolicy.mjs';

test('accepts Bark only when HTTP and business code both succeed', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ code: 200, message: 'success' }) });
  await assert.doesNotReject(sendBarkRequest(new URL('https://example.invalid/push'), fetchImpl));
});

test('rejects HTTP 200 with a Bark business failure and keeps the alert retryable', async () => {
  const result = targetWithEarlyAlert();
  const plan = planNotifications([result], {}, '2026-10-20T00:00:00.000Z');
  const fetchImpl = async () => ({ ok: true, json: async () => ({ code: 400, message: 'failed' }) });

  await assert.rejects(sendBarkRequest(new URL('https://example.invalid/push'), fetchImpl), /Bark business response failed/);
  const retry = planNotifications([result], plan.state, '2026-10-20T01:00:00.000Z');
  assert.equal(retry.results.length, 1);

  const sent = markNotificationsSent(plan, '2026-10-20T00:00:00.000Z');
  const cooledDown = planNotifications([result], sent, '2026-10-20T01:00:00.000Z');
  assert.equal(cooledDown.results.length, 0);
});

test('rejects a non-JSON Bark response', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid json'); } });
  await assert.rejects(sendBarkRequest(new URL('https://example.invalid/push'), fetchImpl), /invalid JSON/);
});

function targetWithEarlyAlert() {
  return {
    id: 'lighting',
    name: '照明插座',
    alerts: [{
      id: 'balance-early',
      metric: 'kwh',
      band: 'early',
      level: 'notice',
      repeatHours: 72,
      message: '提前提醒'
    }]
  };
}
