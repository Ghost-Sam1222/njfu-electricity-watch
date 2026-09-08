const TARGETS = [
  {
    id: 'lighting',
    title: '照明用电剩余',
    subtitle: '研楼及9-13栋照明/插座',
    color: '#157a5b',
    expectedDailyKwh: 4
  },
  {
    id: 'ac',
    title: '空调用电剩余',
    subtitle: '本部其他公寓用电',
    color: '#2b6cb0',
    expectedDailyKwh: 24
  }
];

const state = {
  latest: null,
  history: []
};

const colors = {
  grid: '#d8dee9',
  muted: '#667085',
  warn: '#f2b705',
  critical: '#d94141'
};

Promise.all([
  fetchJson('./data/latest.json', { updatedAt: null, targets: [] }),
  fetchJson('./data/history.json', [])
]).then(([latest, history]) => {
  state.latest = latest;
  state.history = Array.isArray(history) ? history : [];
  render();
});

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return response.json();
  } catch {
    return fallback;
  }
}

function render() {
  renderStatus();
  renderBalances();
  renderDailyUsage();
}

function renderStatus() {
  const updated = state.latest?.updatedAt ? new Date(state.latest.updatedAt) : null;
  document.getElementById('updatedAt').textContent = updated
    ? `最近采集 ${formatDateTime(updated)}`
    : '等待第一次采集';

  const alerts = state.latest?.alerts || [];
  const pill = document.getElementById('statusPill');
  const hasCritical = alerts.some(alert => alert.level === 'critical');
  pill.className = `status-pill ${hasCritical ? 'critical' : alerts.length ? 'warn' : 'ok'}`;
  pill.textContent = hasCritical ? '危险' : alerts.length ? '预警' : '正常';
}

function renderBalances() {
  const root = document.getElementById('balances');
  const latestTargets = new Map((state.latest?.targets || []).map(target => [target.id, target]));

  root.innerHTML = TARGETS.map(meta => {
    const target = latestTargets.get(meta.id);
    const level = target?.alerts?.some(alert => alert.level === 'critical')
      ? 'critical'
      : target?.alerts?.length ? 'warn' : 'ok';
    const value = target ? displayRemaining(target.metrics) : { main: '--', unit: '度', extra: '暂无数据' };
    const checkedAt = target?.checkedAt || state.latest?.updatedAt;

    return `
      <article class="balance-card ${level}" style="--accent: ${meta.color}">
        <div class="balance-head">
          <div>
            <p class="label">${escapeHtml(meta.title)}</p>
            <h2>${escapeHtml(meta.subtitle)}</h2>
          </div>
          <span class="state-dot" aria-hidden="true"></span>
        </div>
        <div class="balance-value">
          <strong>${escapeHtml(value.main)}</strong>
          <span>${escapeHtml(value.unit)}</span>
        </div>
        <div class="balance-foot">
          <span>${checkedAt ? formatDateTime(new Date(checkedAt)) : '尚未查询'}</span>
          <span>${escapeHtml(value.extra)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderDailyUsage() {
  const rows = buildDailyUsage(state.history);
  drawDailyLineChart(document.getElementById('dailyLineChart'), rows);
  drawUsagePieChart(document.getElementById('usagePieChart'), rows);
  renderDailySummary(rows);
  renderPieSummary(rows);
}

function displayRemaining(metrics = {}) {
  const kwh = number(metrics.kwh ?? metrics.estimatedKwh);
  const amount = number(metrics.amount);
  if (kwh !== null) {
    return {
      main: formatNumber(kwh),
      unit: '度',
      extra: amount !== null ? `${formatNumber(amount)} 元` : '按接口电量'
    };
  }
  if (amount !== null) {
    return {
      main: formatNumber(amount),
      unit: '元',
      extra: '未识别电量'
    };
  }
  return { main: '--', unit: '度', extra: '未识别数据' };
}

function buildDailyUsage(history) {
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
        intervals: 0,
        anomaly: null
      };
      row.usage += usage;
      row.intervals += 1;
      dailyMap.set(key, row);
    }
  }

  const rows = Array.from(dailyMap.values())
    .map(row => ({ ...row, usage: Number(row.usage.toFixed(2)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  annotateAnomalies(rows);
  return rows.slice(-42);
}

function annotateAnomalies(rows) {
  for (const meta of TARGETS) {
    const list = rows.filter(row => row.targetId === meta.id).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i += 1) {
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
      if (list[i].usage > relativeLimit) {
        list[i].anomaly = `高于近期中位 ${formatNumber(med)} 度`;
      }
    }
  }
}

function drawDailyLineChart(canvas, rows) {
  drawChartBase(canvas, ctx => {
    const { w, h, x0, y0, plotW, plotH } = dims(canvas);
    drawGrid(ctx, x0, y0, plotW, plotH);
    if (!rows.length) return drawEmpty(ctx, canvas, '第二次采集后开始生成日耗');

    const dates = Array.from(new Set(rows.map(row => row.date))).slice(-14);
    const visible = rows.filter(row => dates.includes(row.date));
    const max = Math.max(...visible.map(row => row.usage), 1);

    TARGETS.forEach(meta => {
      const points = dates.map((date, index) => {
        const row = visible.find(item => item.date === date && item.targetId === meta.id);
        if (!row) return null;
        const x = dates.length === 1 ? x0 + plotW / 2 : x0 + plotW * index / (dates.length - 1);
        const y = y0 + plotH - scale(row.usage, 0, max, plotH);
        return { x, y, row };
      }).filter(Boolean);

      if (!points.length) return;
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      points.forEach(point => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (point.row.anomaly) {
          ctx.strokeStyle = colors.critical;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    });

    drawLineAxisLabels(ctx, dates, w, h);
  });
}

function drawUsagePieChart(canvas, rows) {
  drawChartBase(canvas, ctx => {
    const { w, h } = canvasDims(canvas);
    const totals = usageTotals(rows);
    const total = totals.reduce((sum, item) => sum + item.usage, 0);
    if (total <= 0) return drawEmpty(ctx, canvas, '第二次采集后开始生成占比');

    const radius = Math.min(92, w * 0.24, h * 0.32);
    const cx = w < 560 ? w / 2 : w * 0.35;
    const cy = h * 0.48;
    let start = -Math.PI / 2;

    totals.forEach(item => {
      const angle = item.usage / total * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = item.meta.color;
      ctx.fill();
      start += angle;
    });

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.56, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = colors.muted;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('合计', cx, cy - 8);
    ctx.fillStyle = '#18212f';
    ctx.font = '700 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.fillText(`${formatNumber(total)} 度`, cx, cy + 18);

    const legendX = w < 560 ? 24 : w * 0.64;
    const legendY = w < 560 ? cy + radius + 34 : cy - 42;
    ctx.textAlign = 'left';
    totals.forEach((item, index) => {
      const y = legendY + index * 34;
      ctx.fillStyle = item.meta.color;
      ctx.beginPath();
      ctx.arc(legendX, y - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#18212f';
      ctx.font = '700 13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      ctx.fillText(item.meta.title.replace('用电剩余', ''), legendX + 14, y);
      ctx.fillStyle = colors.muted;
      ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      ctx.fillText(`${formatNumber(item.usage)} 度 · ${Math.round(item.usage / total * 100)}%`, legendX + 14, y + 17);
    });
  });
}

function renderDailySummary(rows) {
  const root = document.getElementById('dailySummary');
  if (!rows.length) {
    root.innerHTML = '<p class="empty">需要至少两次成功查询，才能用余额差计算日耗。</p>';
    return;
  }

  const cards = TARGETS.map(meta => {
    const list = rows.filter(row => row.targetId === meta.id).slice(-7);
    const average = list.length ? list.reduce((sum, row) => sum + row.usage, 0) / list.length : null;
    const latest = list.at(-1);
    const anomalies = list.filter(row => row.anomaly);
    return `
      <div class="usage-stat">
        <span class="legend-dot" style="background: ${meta.color}"></span>
        <strong>${escapeHtml(meta.title)}</strong>
        <span>近7次均值 ${average === null ? '--' : `${formatNumber(average)} 度`}</span>
        <span>最近 ${latest ? `${formatNumber(latest.usage)} 度` : '--'}</span>
        <span class="${anomalies.length ? 'danger-text' : ''}">异常 ${anomalies.length} 次</span>
      </div>
    `;
  }).join('');

  const anomalyRows = rows.filter(row => row.anomaly).slice(-5);
  const anomalyText = anomalyRows.length
    ? anomalyRows.map(row => {
      const meta = TARGETS.find(item => item.id === row.targetId);
      return `<li>${escapeHtml(row.date)} ${escapeHtml(meta?.title || row.targetId)} ${formatNumber(row.usage)} 度，${escapeHtml(row.anomaly)}</li>`;
    }).join('')
    : '<li>近期没有日耗突增。</li>';

  root.innerHTML = `
    <div class="usage-stats">${cards}</div>
    <ul class="anomaly-list">${anomalyText}</ul>
  `;
}

function renderPieSummary(rows) {
  const root = document.getElementById('pieSummary');
  const totals = usageTotals(rows);
  const total = totals.reduce((sum, item) => sum + item.usage, 0);
  if (total <= 0) {
    root.innerHTML = '<p class="empty">需要至少两次成功查询，才能计算占比。</p>';
    return;
  }

  root.innerHTML = `
    <div class="usage-stats">
      ${totals.map(item => `
        <div class="usage-stat">
          <span class="legend-dot" style="background: ${item.meta.color}"></span>
          <strong>${escapeHtml(item.meta.title.replace('用电剩余', ''))}</strong>
          <span>${formatNumber(item.usage)} 度</span>
          <span>${Math.round(item.usage / total * 100)}%</span>
        </div>
      `).join('')}
    </div>
  `;
}

function drawChartBase(canvas, draw) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = Number(canvas.getAttribute('height')) * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  draw(ctx);
}

function dims(canvas) {
  const w = canvas.clientWidth;
  const h = Number(canvas.getAttribute('height'));
  return { w, h, x0: 44, y0: 18, plotW: w - 66, plotH: h - 56 };
}

function drawGrid(ctx, x, y, w, h) {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const yy = y + h * i / 4;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
}

function drawLineAxisLabels(ctx, dates, w, h) {
  ctx.fillStyle = colors.muted;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.fillText('度/日', 44, h - 14);
  const text = dates.length > 1
    ? `${dates[0].slice(5)} 至 ${dates.at(-1).slice(5)}`
    : dates[0]?.slice(5) || '最近 14 天';
  ctx.fillText(text, Math.max(44, w - 116), h - 14);
}

function canvasDims(canvas) {
  return {
    w: canvas.clientWidth,
    h: Number(canvas.getAttribute('height'))
  };
}

function usageTotals(rows) {
  const dates = Array.from(new Set(rows.map(row => row.date))).slice(-14);
  const visible = rows.filter(row => dates.includes(row.date));
  return TARGETS.map(meta => ({
    meta,
    usage: Number(visible
      .filter(row => row.targetId === meta.id)
      .reduce((sum, row) => sum + row.usage, 0)
      .toFixed(2))
  }));
}

function drawEmpty(ctx, canvas, text) {
  ctx.fillStyle = colors.muted;
  ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.fillText(text, 24, Number(canvas.getAttribute('height')) / 2);
}

function remainingKwh(row) {
  return number(row.kwh ?? row.estimatedKwh ?? row.metrics?.kwh ?? row.metrics?.estimatedKwh);
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values, med) {
  return median(values.map(value => Math.abs(value - med)));
}

function groupBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row);
    acc[key] ||= [];
    acc[key].push(row);
    return acc;
  }, {});
}

function scale(value, min, max, size) {
  if (max === min) return size / 2;
  return (value - min) / (max - min) * size;
}

function formatDateTime(date) {
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNumber(value) {
  return Number(value).toFixed(Number(value) >= 10 ? 1 : 2).replace(/\.?0+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
