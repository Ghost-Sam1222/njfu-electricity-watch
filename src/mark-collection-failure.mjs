import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const file = 'docs/data/latest.json';
const previous = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
const failedAt = new Date().toISOString();
const latest = {
  ...previous,
  status: 'error',
  failedAt,
  error: { message: '自动采集失败，余额状态未知' }
};
await writeFile(file, `${JSON.stringify(latest, null, 2)}\n`);
console.log(JSON.stringify({ status: latest.status, failedAt, lastSuccessfulAt: latest.lastSuccessfulAt || latest.updatedAt || null }));
