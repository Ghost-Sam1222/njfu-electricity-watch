import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCasClient, assertCasOk } from './casClient.mjs';
import { writeXlsx } from './xlsxWriter.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind || 'card';
  const rows = args.inputJson
    ? JSON.parse(await readFile(args.inputJson, 'utf8'))
    : await fetchRows(args, kind);

  const outDir = args.outDir || 'exports/bills';
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = kind === 'electricity' && args.feeitemid ? `-${args.feeitemid}` : '';
  const basename = `${kind}${scope}-bills-${args.from || 'start'}_${args.to || stamp}`;
  const jsonPath = path.join(outDir, `${basename}.json`);
  const csvPath = path.join(outDir, `${basename}.csv`);
  const xlsxPath = path.join(outDir, `${basename}.xlsx`);
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
  await writeFile(csvPath, toCsv(rows), 'utf8');
  await writeXlsx(rows, xlsxPath, { kind });
  console.log(JSON.stringify({ kind, count: rows.length, jsonPath, csvPath, xlsxPath }, null, 2));
}

async function fetchRows(args, kind) {
  const client = createCasClient({ baseUrl: args.baseUrl, token: args.token, source: kind === 'card' ? 'h5' : 'pc' });
  const pageSize = Number(args.size || 100);
  const params = { ...args.params, size: pageSize, current: 1 };

  if (args.from) params.timeFrom = args.from;
  if (args.to) params.timeTo = args.to;
  if (args.feeitemid) params.feeitemid = args.feeitemid;

  const rows = [];
  let total = Infinity;
  while (rows.length < total) {
    const response = kind === 'electricity'
      ? assertCasOk(await client.getElectricBillRows(params), 'export electricity bills')
      : assertCasOk(await client.getCardBillRows(params), 'export card bills');
    const pageRows = extractRows(response);
    rows.push(...pageRows);
    total = extractTotal(response, rows.length);
    if (!pageRows.length || rows.length >= total) break;
    params.current += 1;
  }
  return rows;
}

function extractRows(response) {
  const candidates = [
    response.records,
    response.data?.records,
    response.data?.list,
    response.data,
    response.accountList,
    response.billList,
    response.rows,
    response.list
  ];
  const found = candidates.find(Array.isArray);
  return found || [];
}

function extractTotal(response, fallback) {
  return Number(
    response.total ??
    response.count ??
    response.data?.total ??
    response.data?.count ??
    fallback
  );
}

function toCsv(rows) {
  if (!rows.length) return '\ufeff';
  const keys = Array.from(new Set(rows.flatMap(row => Object.keys(flatten(row)))));
  const lines = [keys.join(',')];
  for (const row of rows) {
    const flat = flatten(row);
    lines.push(keys.map(key => csvCell(flat[key])).join(','));
  }
  return `\ufeff${lines.join('\n')}\n`;
}

function flatten(obj, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { [prefix || 'value']: obj };
  return Object.fromEntries(Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(flatten(value, next));
    return [[next, value]];
  }));
}

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseArgs(argv) {
  const args = { params: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kind') args.kind = argv[++i];
    else if (arg === '--from') args.from = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--feeitemid') args.feeitemid = argv[++i];
    else if (arg === '--size') args.size = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--input-json') args.inputJson = argv[++i];
    else if (arg === '--base-url') args.baseUrl = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--param') {
      const [key, ...rest] = String(argv[++i] || '').split('=');
      args.params[key] = rest.join('=');
    }
  }
  return args;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
