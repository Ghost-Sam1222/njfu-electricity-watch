export function getDataStatus(latest, now = new Date(), staleAfterHours = 18) {
  if (!latest?.updatedAt && !latest?.lastSuccessfulAt) return { kind: 'empty', label: '无数据' };
  if (latest.status === 'error') return { kind: 'error', label: '采集失败' };

  const timestamp = Date.parse(latest.lastSuccessfulAt || latest.updatedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return { kind: 'stale', label: '数据过期' };
  const ageHours = (current - timestamp) / 36e5;
  if (ageHours > staleAfterHours) return { kind: 'stale', label: '数据过期', ageHours };
  return { kind: 'ok', label: '正常', ageHours };
}
