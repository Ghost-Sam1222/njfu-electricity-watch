import dns from 'node:dns/promises';
import { createCasClient } from './casClient.mjs';

const baseUrl = (process.env.CAS_BASE_URL || 'https://icard.njfu.edu.cn').replace(/\/$/, '');
const host = new URL(baseUrl).hostname;

async function main() {
  console.log(`Base URL: ${baseUrl}`);
  console.log(`HTTPS proxy configured: ${Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)}`);
  console.log(`NO_PROXY configured: ${Boolean(process.env.NO_PROXY)}`);
  console.log(`SYNJONES_AUTH configured: ${Boolean(process.env.SYNJONES_AUTH || process.env.CAS_TOKEN)}`);

  await step('DNS A records', async () => {
    const records = await dns.resolve4(host);
    return records.join(', ') || 'none';
  });

  await step('Open charge app page', async () => {
    const response = await fetch(`${baseUrl}/charge-app/`);
    return `${response.status} ${response.statusText}`;
  });

  await step('Open charge API entry', async () => {
    const client = createCasClient({ baseUrl, source: 'h5' });
    const response = await client.getSingleFeeitem(489);
    return summarizeResponse(response);
  });
}

async function step(name, fn) {
  try {
    const result = await fn();
    console.log(`[ok] ${name}: ${result}`);
  } catch (error) {
    console.log(`[fail] ${name}: ${error.message}`);
  }
}

function summarizeResponse(data) {
  if (!data || typeof data !== 'object') return typeof data;
  const parts = [];
  if ('code' in data) parts.push(`code=${data.code}`);
  if (data.msg || data.message) parts.push(`message=${data.msg || data.message}`);
  if (data.map || data.data) parts.push('payload=yes');
  return parts.join(', ') || `keys=${Object.keys(data).slice(0, 8).join(',')}`;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
