const KWH_KEYS = /电量|剩余电|剩余用电|度数|kwh|kilowatt|quantity|power|remain/i;
const AMOUNT_KEYS = /余额|金额|剩余金额|可用金额|元|balance|amount|money/i;

export function flattenShowData(value, prefix = '') {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [{ key: prefix || 'value', value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenShowData(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return flattenShowData(child, next);
  });
}

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function extractMetrics(showData, options = {}) {
  const entries = flattenShowData(showData);
  const metrics = options.storeRaw ? { raw: showData, entries } : {};

  for (const entry of entries) {
    const key = String(entry.key);
    const valueText = String(entry.value ?? '');
    const probe = `${key} ${valueText}`;
    if (metrics.kwh === undefined && KWH_KEYS.test(probe)) {
      const number = parseKwhNumber(probe);
      if (number !== null) metrics.kwh = number;
    }
    if (metrics.amount === undefined && AMOUNT_KEYS.test(probe)) {
      const number = parseAmountNumber(probe);
      if (number !== null) metrics.amount = number;
    }
  }

  if (metrics.kwh === undefined && metrics.amount !== undefined && options.kwhPrice) {
    metrics.estimatedKwh = Number((metrics.amount / options.kwhPrice).toFixed(2));
  }

  return metrics;
}

function parseKwhNumber(value) {
  const text = String(value ?? '').replace(/,/g, '');
  const preferred = text.match(/(?:剩余电量|剩余用电|剩余电|电量|度数|kwh|quantity|power|remain)[^\d-]*(-?\d+(?:\.\d+)?)/i);
  if (preferred) return Number(preferred[1]);
  const unit = text.match(/(-?\d+(?:\.\d+)?)\s*(?:度|kwh|千瓦时)/i);
  if (unit) return Number(unit[1]);
  return parseNumber(text);
}

function parseAmountNumber(value) {
  const text = String(value ?? '').replace(/,/g, '');
  const preferred = text.match(/(?:余额|金额|剩余金额|可用金额|balance|amount|money)[^\d-]*(-?\d+(?:\.\d+)?)/i);
  if (preferred) return Number(preferred[1]);
  const unit = text.match(/(-?\d+(?:\.\d+)?)\s*(?:元|rmb|cny)/i);
  if (unit) return Number(unit[1]);
  return parseNumber(text);
}

export function evaluateThreshold(target, metrics) {
  const threshold = target.threshold || {};
  const alerts = [];
  const effectiveKwh = metrics.kwh ?? metrics.estimatedKwh;

  if (typeof threshold.kwh === 'number' && effectiveKwh !== undefined && effectiveKwh < threshold.kwh) {
    alerts.push({
      level: effectiveKwh <= (threshold.criticalKwh ?? threshold.kwh / 2) ? 'critical' : 'warning',
      metric: metrics.kwh === undefined ? 'estimatedKwh' : 'kwh',
      message: `剩余电量约 ${effectiveKwh} 度，低于 ${threshold.kwh} 度`
    });
  }

  if (typeof threshold.amount === 'number' && metrics.amount !== undefined && metrics.amount < threshold.amount) {
    alerts.push({
      level: metrics.amount <= (threshold.criticalAmount ?? threshold.amount / 2) ? 'critical' : 'warning',
      metric: 'amount',
      message: `剩余金额 ${metrics.amount} 元，低于 ${threshold.amount} 元`
    });
  }

  if (typeof threshold.minHours === 'number' && typeof threshold.dailyKwh === 'number' && effectiveKwh !== undefined) {
    const hours = effectiveKwh / (threshold.dailyKwh / 24);
    if (hours < threshold.minHours) {
      alerts.push({
        level: hours < 12 ? 'critical' : 'warning',
        metric: 'runtime',
        message: `按日耗电 ${threshold.dailyKwh} 度估算，仅可支撑约 ${hours.toFixed(1)} 小时`
      });
    }
  }

  return alerts;
}

export function remainingKwhFromMetrics(metrics = {}) {
  const value = metrics.kwh ?? metrics.estimatedKwh;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function detectUsageAnomaly(target, current, historyRows = []) {
  const threshold = target.threshold || {};
  const currentKwh = remainingKwhFromMetrics(current.metrics);
  if (currentKwh === null || !current.checkedAt) return null;

  const previousRows = historyRows
    .filter(row => row.id === current.id && rowKwh(row) !== null && row.checkedAt)
    .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
  const previous = previousRows.at(-1);
  if (!previous) return null;

  const previousKwh = typeof previous.kwh === 'number' ? previous.kwh : previous.estimatedKwh;
  const hours = (Date.parse(current.checkedAt) - Date.parse(previous.checkedAt)) / 36e5;
  const usageKwh = previousKwh - currentKwh;
  if (hours <= 0 || hours > 72) return null;
  if (usageKwh < -0.05) {
    return {
      kind: 'recharge',
      hours: Number(hours.toFixed(2)),
      usageKwh: 0,
      projectedDailyKwh: 0
    };
  }
  if (usageKwh < 0.05) return null;

  const projectedDailyKwh = usageKwh / hours * 24;
  const priorRates = buildPriorUsageRates(previousRows);
  const expectedDailyKwh = threshold.dailyKwh;
  const multiplier = threshold.anomalyMultiplier ?? 1.8;
  const hardLimit = typeof expectedDailyKwh === 'number' ? expectedDailyKwh * multiplier : null;

  if (hardLimit !== null && projectedDailyKwh > hardLimit) {
    return anomalyResult('hard-limit', hours, usageKwh, projectedDailyKwh, `折算日耗 ${projectedDailyKwh.toFixed(1)} 度，超过保守上限 ${hardLimit.toFixed(1)} 度`);
  }

  const minSamples = threshold.anomalyMinSamples ?? 7;
  if (priorRates.length < minSamples || typeof expectedDailyKwh !== 'number') {
    return {
      kind: 'usage',
      hours: Number(hours.toFixed(2)),
      usageKwh: Number(usageKwh.toFixed(2)),
      projectedDailyKwh: Number(projectedDailyKwh.toFixed(2))
    };
  }

  const recent = priorRates.slice(-14);
  const med = median(recent);
  const spread = Math.max(mad(recent, med) * 1.4826, expectedDailyKwh * 0.15, 1);
  const relativeLimit = Math.max(med * 1.7, med + 3 * spread);
  if (projectedDailyKwh > relativeLimit) {
    return anomalyResult('relative-spike', hours, usageKwh, projectedDailyKwh, `折算日耗 ${projectedDailyKwh.toFixed(1)} 度，高于近期中位 ${med.toFixed(1)} 度`);
  }

  return {
    kind: 'usage',
    hours: Number(hours.toFixed(2)),
    usageKwh: Number(usageKwh.toFixed(2)),
    projectedDailyKwh: Number(projectedDailyKwh.toFixed(2))
  };
}

export function summarizeMetrics(metrics) {
  const parts = [];
  if (metrics.kwh !== undefined) parts.push(`${metrics.kwh} 度`);
  if (metrics.estimatedKwh !== undefined) parts.push(`约 ${metrics.estimatedKwh} 度`);
  if (metrics.amount !== undefined) parts.push(`${metrics.amount} 元`);
  return parts.join(' / ') || '未识别到数值，请查看 raw 数据';
}

function buildPriorUsageRates(rows) {
  const rates = [];
  const sorted = rows.slice().sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = rowKwh(sorted[i - 1]);
    const curr = rowKwh(sorted[i]);
    const hours = (Date.parse(sorted[i].checkedAt) - Date.parse(sorted[i - 1].checkedAt)) / 36e5;
    const usage = prev - curr;
    if (hours > 0 && hours <= 72 && usage >= 0.05) rates.push(usage / hours * 24);
  }
  return rates;
}

function rowKwh(row) {
  if (typeof row.kwh === 'number' && Number.isFinite(row.kwh)) return row.kwh;
  if (typeof row.estimatedKwh === 'number' && Number.isFinite(row.estimatedKwh)) return row.estimatedKwh;
  return null;
}

function anomalyResult(kind, hours, usageKwh, projectedDailyKwh, message) {
  return {
    kind,
    hours: Number(hours.toFixed(2)),
    usageKwh: Number(usageKwh.toFixed(2)),
    projectedDailyKwh: Number(projectedDailyKwh.toFixed(2)),
    alert: {
      level: 'warning',
      metric: 'usage',
      message
    }
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values, med) {
  return median(values.map(value => Math.abs(value - med)));
}
