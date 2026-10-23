const LEVEL_RANK = { notice: 1, warning: 2, critical: 3 };

export function planNotifications(results, previousState = {}, now = new Date().toISOString()) {
  const previous = previousState.active || {};
  const active = {};
  const selectedKeys = new Set();
  const plannedResults = [];

  for (const result of results) {
    const selectedAlerts = [];
    for (const alert of result.alerts || []) {
      const key = alertKey(result.id, alert);
      const prior = previous[key];
      const repeatHours = alert.repeatHours ?? 24;
      const elapsedHours = prior?.lastNotifiedAt
        ? (Date.parse(now) - Date.parse(prior.lastNotifiedAt)) / 36e5
        : Infinity;
      const escalated = prior && (LEVEL_RANK[alert.level] || 0) > (LEVEL_RANK[prior.level] || 0);
      const shouldNotify = !prior?.lastNotifiedAt || escalated || elapsedHours >= repeatHours;

      active[key] = {
        level: alert.level,
        band: alert.band || null,
        lastSeenAt: now,
        lastNotifiedAt: prior?.lastNotifiedAt || null
      };
      if (shouldNotify) {
        selectedKeys.add(key);
        selectedAlerts.push(alert);
      }
    }
    if (selectedAlerts.length) plannedResults.push({ ...result, alerts: selectedAlerts });
  }

  return {
    results: plannedResults,
    selectedKeys: [...selectedKeys],
    state: { updatedAt: now, active }
  };
}

export function markNotificationsSent(plan, sentAt = new Date().toISOString()) {
  const sent = new Set(plan.selectedKeys || []);
  const active = Object.fromEntries(Object.entries(plan.state.active || {}).map(([key, value]) => [
    key,
    sent.has(key) ? { ...value, lastNotifiedAt: sentAt } : value
  ]));
  return { ...plan.state, updatedAt: sentAt, active };
}

function alertKey(targetId, alert) {
  if (alert.id?.startsWith('balance-')) return `${targetId}:balance`;
  return `${targetId}:${alert.id || `${alert.metric || 'alert'}:${alert.band || alert.message}`}`;
}
