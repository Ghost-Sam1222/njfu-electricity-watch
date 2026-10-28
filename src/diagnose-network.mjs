import dns from 'node:dns/promises';
import { createCasClient } from './casClient.mjs';
import { publicErrorMessage } from './publicError.mjs';

const baseUrl = (process.env.CAS_BASE_URL || 'https://icard.njfu.edu.cn').replace(/\/$/, '');
async function main() {
  const host = new URL(baseUrl).hostname;
  console.log(`Target host: ${host}`);
  console.log(`HTTPS proxy configured: ${Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)}`);
  console.log(`NO_PROXY configured: ${Boolean(process.env.NO_PROXY)}`);
  console.log(`SYNJONES_AUTH configured: ${Boolean(process.env.SYNJONES_AUTH || process.env.CAS_TOKEN)}`);

  await step('DNS A records', async () => {
    const records = await dns.resolve4(host);
    return records.join(', ') || 'none';
  });

  await step('Open charge app page', async () => {
    const response = await fetch(`${baseUrl}/charge-app/`);
    return `HTTP ${Number(response.status)}`;
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
    console.log(`[fail] ${name}: ${publicErrorMessage(error)}`);
  }
}

function summarizeResponse(data) {
  if (!data || typeof data !== 'object') return typeof data;
  const parts = [];
  if ('code' in data) parts.push(`code=${Number(data.code) || 'unknown'}`);
  if (data.map || data.data) parts.push('payload=yes');
  return parts.join(', ') || 'unrecognized response';
}

main().catch(error => {
  console.error(publicErrorMessage(error));
  process.exitCode = 1;
});
