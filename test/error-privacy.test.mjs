import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDataStatus } from '../docs/status.mjs';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const canary = 'SYNTHETIC_PRIVATE_CANARY';
const mock = `
import { writeFileSync } from 'node:fs';
const marker = ${JSON.stringify(canary)};
globalThis.fetch = async input => {
  const url = new URL(input);
  const scenario = process.env.TEST_SCENARIO;
  if (url.hostname === 'bark.invalid') {
    const body = decodeURIComponent(url.pathname.split('/').at(-1));
    if (body.includes('自动查询没有成功')) {
      writeFileSync('failure-body.txt', body);
      return new Response('{"code":200}');
    }
    if (scenario === 'bark-timeout') throw new Error('timeout ' + url + ' Cookie=' + marker);
    if (scenario === 'bark-http') return new Response(marker, {status:503, statusText:marker});
    if (scenario === 'bark-json') return new Response(marker);
    if (scenario === 'bark-business') return new Response(JSON.stringify({code:400,message:marker}));
    return new Response('{"code":200}');
  }
  if (scenario === 'cas-timeout') throw new Error('timeout', {cause:new Error('proxy http://user:' + marker + '@proxy.invalid Cookie=' + marker)});
  if (scenario === 'cas-http') return new Response(marker, {status:401,statusText:marker});
  if (scenario === 'cas-business') return new Response(JSON.stringify({code:401,msg:marker}));
  if (scenario === 'cas-html') return new Response('<html>' + marker + '</html>');
  return new Response('{"code":200,"map":{"showData":{"剩余电量":1}}}');
};
`;

for (const scenario of ['cas-timeout', 'cas-http', 'cas-business', 'cas-html', 'bark-timeout', 'bark-http', 'bark-json', 'bark-business', 'bark-invalid-url']) {
  test(`CLI ${scenario} keeps secrets private and exposes failure`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'electricity-privacy-'));
    try {
      await mkdir(path.join(dir, 'docs/data'), { recursive: true });
      const previous = {status:'ok', updatedAt:'2026-10-20T00:00:00.000Z', targets:[{id:'lighting', metrics:{kwh:8}}]};
      await writeFile(path.join(dir, 'docs/data/latest.json'), JSON.stringify(previous));
      await writeFile(path.join(dir, 'targets.json'), JSON.stringify({targets:[{id:'lighting',name:'照明插座',feeitemid:489,autoResolve:false,threshold:{kwh:20}}]}));
      const run = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, path.join(root,'src/query-electricity.mjs'), '--config', 'targets.json'], {
        cwd: dir,
        env: { PATH:process.env.PATH, TEST_SCENARIO:scenario, SYNJONES_AUTH:canary, BARK_URL:scenario === 'bark-invalid-url' ? `https://invalid host/${canary}` : `https://bark.invalid/${canary}/` },
        encoding:'utf8', timeout:15000
      });
      assert.equal(run.status, 1, 'failed collection/delivery must exit unsuccessfully');
      assert.equal((run.stdout + run.stderr).includes(canary), false, 'CLI output must not expose synthetic credentials');
      if (scenario !== 'bark-invalid-url') {
        const body = await readFile(path.join(dir, 'failure-body.txt'), 'utf8');
        assert.equal(body.includes(canary), false, 'failure push must not echo upstream credentials');
      }
      const marked = spawnSync(process.execPath, [path.join(root,'src/mark-collection-failure.mjs')], {cwd:dir,encoding:'utf8'});
      assert.equal(marked.status, 0);
      const latest = JSON.parse(await readFile(path.join(dir,'docs/data/latest.json'),'utf8'));
      assert.equal(getDataStatus(latest).kind, 'error');
      if (scenario.startsWith('cas-')) assert.deepEqual(latest.targets, previous.targets, 'query failure must preserve last known balance');
      const cached = {...previous,status:'ok'};
      assert.equal(getDataStatus(cached,'2026-10-21T00:00:00.000Z').kind,'stale');
    } finally {
      await rm(dir, {recursive:true,force:true});
    }
  });
}

test('proxy setup keeps an invalid subscription private', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-privacy-'));
  try {
    await writeFile(path.join(dir,'curl'), '#!/bin/sh\nexit 22\n');
    await chmod(path.join(dir,'curl'), 0o755);
    const run = spawnSync('bash', [path.join(root,'scripts/setup-mihomo.sh')], {
      env:{PATH:`${dir}:${process.env.PATH}`,RUNNER_TEMP:dir,CLASH_SUBSCRIPTION_URL:`https://invalid host/${canary}`},encoding:'utf8'
    });
    assert.equal(run.status,1);
    assert.equal((run.stdout + run.stderr).includes(canary),false,'subscription parser must not print its input');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('diagnostics keeps an invalid base URL private', () => {
  const run = spawnSync(process.execPath, [path.join(root,'src/diagnose-network.mjs')], {
    env:{PATH:process.env.PATH,CAS_BASE_URL:`https://invalid host/${canary}`},encoding:'utf8'
  });
  assert.equal(run.status,1);
  assert.equal((run.stdout + run.stderr).includes(canary),false,'invalid URL must be caught inside the safe error boundary');
});

test('proxy startup failure does not publish credential-bearing core logs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-log-privacy-'));
  try {
    await writeFile(path.join(dir,'core.gz'),gzipSync(`#!/bin/sh\necho 'proxy auth ${canary}'\nexit 1\n`));
    const stubs = {
      curl: '#!/bin/sh\ncase "$*" in *--proxy*) exit 7;; esac\nprevious=""\nfor argument in "$@"; do\nif [ "$previous" = "-o" ]; then cp "$FAKE_ARCHIVE" "$argument"; exit 0; fi\nprevious="$argument"\ndone\nexit 22\n',
      seq: '#!/bin/sh\necho 1\n',
      sleep: '#!/bin/sh\n/bin/sleep 0.1\n'
    };
    for (const [name,source] of Object.entries(stubs)) {
      await writeFile(path.join(dir,name),source);
      await chmod(path.join(dir,name),0o755);
    }
    const run = spawnSync('bash',[path.join(root,'scripts/setup-mihomo.sh')], {
      env:{PATH:`${dir}:${process.env.PATH}`,RUNNER_TEMP:dir,CLASH_CONFIG_YAML:'proxies: []',FAKE_ARCHIVE:path.join(dir,'core.gz')},encoding:'utf8',timeout:5000
    });
    assert.equal(run.status,1);
    assert.match(run.stdout,/did not become ready/);
    assert.equal((run.stdout + run.stderr).includes(canary),false,'core diagnostic details must stay out of public Actions logs');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
