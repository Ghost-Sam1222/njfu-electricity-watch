import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createCasClient, assertCasOk } from './casClient.mjs';
import { detectUsageAnomaly, evaluateThreshold, extractMetrics, summarizeMetrics } from './thresholds.mjs';

const DEFAULT_CONFIG = 'config/targets.json';
const EXAMPLE_CONFIG = 'config/targets.example.json';
const LATEST_PATH = 'docs/data/latest.json';
const HISTORY_PATH = 'docs/data/history.json';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config || DEFAULT_CONFIG, Boolean(args.discover));
  const client = createCasClient({
    baseUrl: config.defaults?.baseUrl,
    token: args.token,
    source: config.defaults?.source || 'h5'
  });

  if (args.discover) {
    await discover(client, args, config);
    return;
  }

  const targets = (config.targets || []).filter(target => target.enabled !== false);
  if (!targets.length) throw new Error('No enabled targets in config/targets.json');

  const now = new Date().toISOString();
  const history = await readHistory(HISTORY_PATH);
  const results = [];
  for (const target of targets) {
    const result = await queryTarget(client, target, config.defaults || {});
    results.push({ checkedAt: now, ...result });
  }
  annotateUsage(results, targets, history);

  const latest = {
    updatedAt: now,
    targets: results,
    alerts: results.flatMap(result => result.alerts.map(alert => ({ targetId: result.id, targetName: result.name, ...alert })))
  };

  await writeJson(LATEST_PATH, latest);
  await appendHistory(HISTORY_PATH, results, history);

  const alertResults = results.filter(result => result.alerts.length > 0);
  if (alertResults.length > 0) await notifyBark(alertResults, config.defaults?.bark || {});

  console.log(JSON.stringify(latest, null, 2));
}

async function queryTarget(client, target, defaults) {
  const params = await buildQueryParams(client, target, defaults);
  if (params.level === undefined) params.level = inferLevel(params);
  params.feeitemid = target.feeitemid;
  const response = assertCasOk(await client.getThirdData(params), `query ${target.name}`);
  const map = response.map || response.data || response;
  const showData = map.showData || map.data?.showData || map.data || map;
  const metrics = extractMetrics(showData, defaults);
  const alerts = evaluateThreshold(target, metrics);

  return {
    id: target.id,
    name: target.name,
    feeitemid: target.feeitemid,
    metrics,
    summary: summarizeMetrics(metrics),
    alerts,
    queryParams: redactQueryParams(params, defaults),
    raw: map
  };
}

async function buildQueryParams(client, target, defaults) {
  const params = {
    type: 'IEC',
    ...(target.params || {})
  };
  if (target.selectors?.length || target.autoResolve !== false) {
    await applySelectors(client, target, params, defaults);
  }
  const roomCode = target.roomCode || defaults.roomCode;
  const roomParam = target.roomParam || defaults.roomParam;
  if (roomCode && roomParam && params[roomParam] === undefined) {
    params[roomParam] = roomCode;
  }
  return params;
}

async function applySelectors(client, target, params, defaults) {
  const selectors = target.selectors || [];
  if (!selectors.length) return;

  let dataParams = {
    ...params,
    feeitemid: target.feeitemid,
    type: 'select',
    level: 0
  };
  let map = await getThirdDataMap(client, dataParams, `resolve ${target.name}`);
  let fields = sortedFields(map);

  for (const selector of selectors) {
    const field = nextSelectField(fields, dataParams);
    if (!field) throw new Error(`${target.name}: cannot find a selectable field for ${selector}`);
    const choice = findChoice(map.data, selector);
    if (!choice) {
      const names = Array.isArray(map.data) ? map.data.map(item => item.name || item.label || item.value).filter(Boolean).join(', ') : 'no choices';
      throw new Error(`${target.name}: cannot find option "${selector}". Choices: ${names}`);
    }
    params[field.code] = choice.value;
    dataParams = { ...dataParams, [field.code]: choice.value, level: Number(field.level), type: 'select' };
    if (selector !== selectors.at(-1)) {
      map = await getThirdDataMap(client, dataParams, `resolve ${target.name}`);
      fields = sortedFields(map).length ? sortedFields(map) : fields;
    }
  }

  const roomCode = target.roomCode || defaults.roomCode;
  const roomField = findRoomField(fields, params);
  if (roomCode && roomField && params[roomField.code] === undefined) {
    params[roomField.code] = roomCode;
  }
  params.level = Math.max(...fields.map(field => Number(field.level)).filter(Number.isFinite), selectors.length + 1);
  params.type = 'IEC';
}

async function getThirdDataMap(client, params, context) {
  const response = assertCasOk(await client.getThirdData(params), context);
  return response.map || response.data || response;
}

function sortedFields(map) {
  return Array.isArray(map?.total)
    ? map.total.slice().sort((a, b) => Number(a.level) - Number(b.level))
    : [];
}

function nextSelectField(fields, params) {
  return fields.find(field => field.code && params[field.code] === undefined);
}

function findRoomField(fields, params) {
  return fields.find(field => field.code && params[field.code] === undefined && /房|房间|宿舍|寝室|room/i.test(field.name || field.code))
    || fields.find(field => field.code && params[field.code] === undefined)
    || fields.at(-1);
}

function findChoice(choices, selector) {
  if (!Array.isArray(choices)) return null;
  const wanted = normalizeText(selector);
  return choices.find(item => normalizeText(item.name || item.label || item.text) === wanted)
    || choices.find(item => normalizeText(item.name || item.label || item.text).includes(wanted))
    || choices.find(item => normalizeText(item.value) === wanted);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function redactQueryParams(params, defaults) {
  const roomCode = defaults.roomCode ? String(defaults.roomCode) : '';
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key,
    roomCode && String(value) === roomCode ? '***room***' : value
  ]));
}

function annotateUsage(results, targets, history) {
  const targetMap = new Map(targets.map(target => [target.id, target]));
  for (const result of results) {
    const target = targetMap.get(result.id);
    if (!target) continue;
    const usage = detectUsageAnomaly(target, result, history);
    if (!usage) continue;
    result.usageInterval = usage;
    if (usage.alert) result.alerts.push(usage.alert);
  }
}

async function discover(client, args, config) {
  const feeitemid = Number(args.discover === true ? args._[0] : args.discover);
  if (!feeitemid) throw new Error('Usage: npm run discover -- 489 [--param code=value --level 1 --type select]');
  const params = {
    type: args.type || 'select',
    level: args.level ?? 0,
    ...args.params,
    feeitemid
  };
  const response = assertCasOk(await client.getThirdData(params), `discover ${feeitemid}`);
  const map = response.map || response.data || response;
  const out = {
    feeitemid,
    requestedParams: params,
    fields: map.total || [],
    choices: map.data || [],
    showData: map.showData || null,
    tipinfo: map.tipinfo || null,
    nextHint: buildNextHint(feeitemid, map, params)
  };
  await mkdir('docs/data', { recursive: true });
  await writeJson(`docs/data/discovery-${feeitemid}.json`, out);
  console.log(JSON.stringify(out, null, 2));
}

function buildNextHint(feeitemid, map, params) {
  const fields = map.total || [];
  const nextLevel = Number(params.level || 0) + 1;
  const currentField = fields.find(field => Number(field.level) === Number(params.level) + 1) || fields[0];
  const firstChoice = Array.isArray(map.data) ? map.data[0] : null;
  if (!currentField || !firstChoice) return `If showData is present, copy requestedParams into config/targets.json.`;
  return `Next: npm run discover -- ${feeitemid} --level ${nextLevel} --param ${currentField.code}=${firstChoice.value}`;
}

async function notifyBark(results, barkConfig) {
  const barkUrl = process.env.BARK_URL;
  if (!barkUrl) {
    console.log('BARK_URL is not set; skip push notification.');
    return;
  }

  const title = results.some(result => result.alerts.some(alert => alert.level === 'critical'))
    ? '南林宿舍电量危险'
    : '南林宿舍电量预警';
  const body = results.map(result => {
    const alerts = result.alerts.map(alert => `- ${alert.message}`).join('\n');
    return `${result.name}\n剩余：${result.summary}\n${alerts}`;
  }).join('\n\n');

  const url = new URL(encodeURIComponent(title) + '/' + encodeURIComponent(body), ensureSlash(barkUrl));
  url.searchParams.set('group', process.env.BARK_GROUP || barkConfig.group || '南林电力守夜');
  url.searchParams.set('sound', process.env.BARK_SOUND || barkConfig.sound || 'alarm');
  url.searchParams.set('level', 'timeSensitive');

  const icon = process.env.BARK_ICON_URL || iconFromPagesBase();
  if (icon) url.searchParams.set('icon', icon);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bark notification failed: ${response.status} ${response.statusText}`);
}

function iconFromPagesBase() {
  const base = process.env.PAGES_BASE_URL;
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/assets/njfu-power-alert.png`;
}

function ensureSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

async function appendHistory(file, results, existingHistory = null) {
  const history = existingHistory || await readHistory(file);
  history.push(...results.map(result => ({
    checkedAt: result.checkedAt,
    id: result.id,
    name: result.name,
    feeitemid: result.feeitemid,
    kwh: result.metrics.kwh ?? null,
    estimatedKwh: result.metrics.estimatedKwh ?? null,
    amount: result.metrics.amount ?? null,
    summary: result.summary,
    alerts: result.alerts,
    usageInterval: result.usageInterval || null
  })));
  const cutoff = Date.now() - 370 * 24 * 60 * 60 * 1000;
  const trimmed = history.filter(item => !item.checkedAt || Date.parse(item.checkedAt) >= cutoff);
  await writeJson(file, trimmed);
}

async function readHistory(file) {
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : [];
}

async function loadConfig(configPath, allowExample) {
  const pathToRead = existsSync(configPath) ? configPath : EXAMPLE_CONFIG;
  if (!existsSync(configPath) && !allowExample) {
    throw new Error(`${configPath} not found. Copy ${EXAMPLE_CONFIG} to ${configPath}, then fill params from discover output.`);
  }
  const raw = JSON.parse(await readFile(pathToRead, 'utf8'));
  if (!existsSync(configPath)) {
    console.warn(`${configPath} not found; using ${EXAMPLE_CONFIG}. Copy it and fill params before enabling scheduled queries.`);
  }
  return raw;
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

function inferLevel(params = {}) {
  if (params.level !== undefined) return params.level;
  const keys = Object.keys(params).filter(key => !['type', 'feeitemid'].includes(key));
  return keys.length;
}

function parseArgs(argv) {
  const args = { _: [], params: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--discover') args.discover = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--type') args.type = argv[++i];
    else if (arg === '--level') args.level = Number(argv[++i]);
    else if (arg === '--param') {
      const [key, ...rest] = String(argv[++i] || '').split('=');
      args.params[key] = rest.join('=');
    } else args._.push(arg);
  }
  return args;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
