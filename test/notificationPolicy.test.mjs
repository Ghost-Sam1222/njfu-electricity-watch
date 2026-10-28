import test from 'node:test';
import assert from 'node:assert/strict';
import { markNotificationsSent, planNotifications } from '../src/notificationPolicy.mjs';

test('deduplicates a band until its repeat interval and repeats important reminders', () => {
  const result = targetWithAlert('early', 'notice', 72);
  const first = planNotifications([result], {}, '2026-10-20T00:00:00.000Z');
  assert.equal(first.results.length, 1);
  const sent = markNotificationsSent(first, '2026-10-20T00:00:00.000Z');

  const quiet = planNotifications([result], sent, '2026-10-22T23:59:00.000Z');
  assert.equal(quiet.results.length, 0);
  const repeat = planNotifications([result], quiet.state, '2026-10-23T00:00:00.000Z');
  assert.equal(repeat.results.length, 1);
});

test('notifies immediately when the balance band becomes more severe', () => {
  const early = planNotifications([targetWithAlert('early', 'notice', 72)], {}, '2026-10-20T00:00:00.000Z');
  const sent = markNotificationsSent(early, '2026-10-20T00:00:00.000Z');
  const strong = planNotifications([targetWithAlert('strong', 'warning', 24)], sent, '2026-10-20T01:00:00.000Z');
  assert.equal(strong.results.length, 1);
  assert.equal(strong.results[0].alerts[0].band, 'strong');
});

test('does not treat a less severe balance band as a new alert', () => {
  const strong = planNotifications([targetWithAlert('strong', 'warning', 24)], {}, '2026-10-20T00:00:00.000Z');
  const sent = markNotificationsSent(strong, '2026-10-20T00:00:00.000Z');
  const early = planNotifications([targetWithAlert('early', 'notice', 72)], sent, '2026-10-20T01:00:00.000Z');
  assert.equal(early.results.length, 0);
});

test('clears resolved alerts so re-entry is notified', () => {
  const first = planNotifications([targetWithAlert('early', 'notice', 72)], {}, '2026-10-20T00:00:00.000Z');
  const sent = markNotificationsSent(first, '2026-10-20T00:00:00.000Z');
  const resolved = planNotifications([{ id: 'lighting', alerts: [] }], sent, '2026-10-20T01:00:00.000Z');
  const reentered = planNotifications([targetWithAlert('early', 'notice', 72)], resolved.state, '2026-10-20T02:00:00.000Z');
  assert.equal(reentered.results.length, 1);
});

function targetWithAlert(band, level, repeatHours) {
  return {
    id: 'lighting',
    name: '照明插座',
    alerts: [{ id: `balance-${band}`, metric: 'kwh', band, level, repeatHours, message: band }]
  };
}
