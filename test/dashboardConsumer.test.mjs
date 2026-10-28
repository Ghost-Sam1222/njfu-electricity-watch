import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { getDataStatus } from '../docs/status.mjs';
import { buildDailyUsage, filterUsageRange } from '../docs/usage.mjs';
import { evaluateThreshold } from '../src/thresholds.mjs';

const marker = fileURLToPath(new URL('../src/mark-collection-failure.mjs', import.meta.url));
const source = (await readFile(new URL('../docs/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');

// Execute the real page entry point with synthetic fetch responses and DOM/canvas sinks.
async function renderSnapshot(latest) {
  const elements = new Map();
  const context2d = new Proxy({}, {get: () => () => {}});
  const document = {getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent:'', innerHTML:'', className:'', dataset:{}, style:{}, clientWidth:640,
      addEventListener() {}, getAttribute() {return '320';},
      getBoundingClientRect() {return {width:640};}, getContext() {return context2d;}
    });
    return elements.get(id);
  }};
  vm.runInNewContext(source, {
    document, window:{devicePixelRatio:1,addEventListener() {}},
    getDataStatus, buildDailyUsage, filterUsageRange,
    fetch:async url => ({ok:true,json:async () => url.includes('latest') ? latest : []})
  }, {filename:'docs/app.js'});
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

async function failedSnapshot(previous) {
  const dir = await mkdtemp(path.join(tmpdir(),'dashboard-consumer-'));
  try {
    await mkdir(path.join(dir,'docs/data'),{recursive:true});
    if (previous) await writeFile(path.join(dir,'docs/data/latest.json'),JSON.stringify(previous));
    const result = spawnSync(process.execPath,[marker],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0);
    return JSON.parse(await readFile(path.join(dir,'docs/data/latest.json'),'utf8'));
  } finally {await rm(dir,{recursive:true,force:true});}
}

function snapshot(balance, ageHours = 1) {
  const timestamp = new Date(Date.now() - ageHours * 36e5).toISOString();
  const alerts = evaluateThreshold({threshold:{kwhBands:{early:70,strong:40,urgent:20}}},{kwh:balance});
  return {status:'ok',updatedAt:timestamp,lastSuccessfulAt:timestamp,alerts,targets:[
    {id:'lighting',checkedAt:timestamp,metrics:{kwh:balance},alerts},
    {id:'ac',checkedAt:timestamp,metrics:{kwh:balance},alerts}
  ]};
}

test('real dashboard keeps 70/40/20 cached balances visibly unavailable after collection failure or expiry', async () => {
  for (const balance of [70,40,20]) {
    for (const [latest,label] of [[await failedSnapshot(snapshot(balance)),'采集失败'],[snapshot(balance,19),'数据过期']]) {
      const page = await renderSnapshot(latest);
      assert.equal(page.get('statusPill').textContent,label);
      assert.equal((page.get('balances').innerHTML.match(/balance-card unavailable/g) || []).length,2);
      assert.match(page.get('balances').innerHTML,new RegExp(`<strong>${balance}</strong>`));
      assert.match(page.get('balances').innerHTML,/上次成功数据/);
      assert.match(page.get('balances').innerHTML,/非实时/);
      assert.match(page.get('updatedAt').textContent,/最近成功/);
    }
  }
});

test('real dashboard distinguishes recent balances from unknown readings without inventing zero', async () => {
  const recent = await renderSnapshot(snapshot(80));
  assert.equal(recent.get('statusPill').textContent,'正常');
  assert.match(recent.get('balances').innerHTML,/balance-card ok/);
  assert.match(recent.get('updatedAt').textContent,/最近采集/);
  for (const balance of [70,40,20]) {
    const page = await renderSnapshot(snapshot(balance));
    assert.equal(page.get('statusPill').textContent,balance === 20 ? '危险' : '预警');
    assert.match(page.get('balances').innerHTML,new RegExp(`balance-card ${balance === 20 ? 'critical' : 'warn'}`));
  }
  const unknown = await renderSnapshot({updatedAt:null,targets:[]});
  assert.equal(unknown.get('statusPill').textContent,'无数据');
  assert.equal((unknown.get('balances').innerHTML.match(/<strong>--<\/strong>/g) || []).length,2);
  assert.doesNotMatch(unknown.get('balances').innerHTML,/<strong>0<\/strong>/);
});

test('real dashboard reports the first collection failure even before any successful reading', async () => {
  const latest = await failedSnapshot();
  const page = await renderSnapshot(latest);
  assert.equal(page.get('statusPill').textContent,'采集失败');
  assert.equal((page.get('balances').innerHTML.match(/<strong>--<\/strong>/g) || []).length,2);
});
