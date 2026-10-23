export function buildDailyUsage(history, targets) {
  const byTarget = groupBy(
    history.filter(row => remainingKwh(row) !== null && row.checkedAt),
    row => row.id
  );
  const dailyMap = new Map();

  for (const [targetId, rows] of Object.entries(byTarget)) {
    const sorted = rows.slice().sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevKwh = remainingKwh(prev);
      const currKwh = remainingKwh(curr);
      const hours = (Date.parse(curr.checkedAt) - Date.parse(prev.checkedAt)) / 36e5;
      const usage = prevKwh - currKwh;
      if (hours <= 0 || hours > 72 || usage < 0.05) continue;

      const date = localDateKey(new Date(curr.checkedAt));
      const key = `${date}:${targetId}`;
      const row = dailyMap.get(key) || {
        date,
        targetId,
        usage: 0,
        hours: 0,
        intervals: 0,
        intervalDetails: [],
        anomaly: null
      };
      row.usage += usage;
      row.hours += hours;
      row.intervals += 1;
      row.intervalDetails.push({
        hours,
        usage,
        projectedDailyKwh: usage / hours * 24
      });
      dailyMap.set(key, row);
    }
  }

  const rows = Array.from(dailyMap.values())
    .map(row => ({
      ...row,
      usage: Number(row.usage.toFixed(2)),
      hours: Number(row.hours.toFixed(2)),
      projectedDailyKwh: Number((row.usage / row.hours * 24).toFixed(2)),
      shortInterval: row.intervalDetails.every(interval => interval.hours < minimumHours(targets, row.targetId))
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  annotateAnomalies(rows, targets);
  return rows;
}

export function filterUsageRange(rows, days) {
  const dates = Array.from(new Set(rows.map(row => row.date))).sort();
  const visibleDates = dates.slice(-days);
  return rows.filter(row => visibleDates.includes(row.date));
}

function annotateAnomalies(rows, targets) {
  for (const meta of targets) {
    const list = rows.filter(row => row.targetId === meta.id).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i += 1) {
      if (meta.id === 'lighting') {
        const minHours = minimumHours(targets, meta.id);
        const trusted = list[i].intervalDetails.filter(interval => interval.hours >= minHours);
        const highest = Math.max(...trusted.map(interval => interval.projectedDailyKwh), -Infinity);
        const hardLimit = meta.anomalyHardLimitKwh ?? meta.expectedDailyKwh * 1.8;
        if (highest > hardLimit) {
          list[i].anomaly = `24小时折算 ${formatNumber(highest)} 度，超过保守上限 ${formatNumber(hardLimit)} 度`;
        }
        continue;
      }

      const previous = list.slice(Math.max(0, i - 14), i).map(row => row.usage);
      const hardLimit = meta.expectedDailyKwh * 1.8;
      if (list[i].usage > hardLimit) {
        list[i].anomaly = `超过保守上限 ${formatNumber(hardLimit)} 度`;
        continue;
      }
      if (previous.length < 7) continue;
      const med = median(previous);
      const spread = Math.max(mad(previous, med) * 1.4826, meta.expectedDailyKwh * 0.15, 1);
      const relativeLimit = Math.max(med * 1.7, med + 3 * spread);
      if (list[i].usage > relativeLimit) list[i].anomaly = `高于近期中位 ${formatNumber(med)} 度`;
    }
  }
}

function minimumHours(targets, targetId) {
  return targets.find(target => target.id === targetId)?.anomalyMinIntervalHours || 0;
}

function remainingKwh(row) {
  return number(row.kwh ?? row.estimatedKwh ?? row.metrics?.kwh ?? row.metrics?.estimatedKwh);
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function groupBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row);
    acc[key] ||= [];
    acc[key].push(row);
    return acc;
  }, {});
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values, med) {
  return median(values.map(value => Math.abs(value - med)));
}

function formatNumber(value) {
  return Number(value).toFixed(Number(value) >= 10 ? 1 : 2).replace(/\.?0+$/, '');
}
