import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const icon = 'https://ghost-sam1222.github.io/njfu-electricity-watch/assets/njfu-power-alert.png';
const mock = `
import { writeFileSync } from 'node:fs';
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.hostname === 'bark.invalid') {
    writeFileSync('push.json', JSON.stringify({icon:url.searchParams.get('icon')}));
    return new Response('{"code":200}');
  }
  return new Response('{"code":200,"map":{"showData":{"剩余电量":1}}}');
};`;

test('scheduled collection passes the existing public icon to Bark', async () => {
  const workflow = await readFile(path.join(root,'.github/workflows/electricity-watch.yml'),'utf8');
  assert.ok(workflow.includes(`BARK_ICON_URL: ${icon}`));
});

for (const fail of [false,true]) {
  test(`${fail ? 'failure' : 'balance'} notification carries the configured icon in the real request`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(),'bark-icon-'));
    try {
      await writeFile(path.join(dir,'targets.json'),JSON.stringify({targets:[{id:'lighting',name:'照明插座',feeitemid:489,autoResolve:false,threshold:{kwh:20}}]}));
      const result = spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(mock)}`,path.join(root,'src/query-electricity.mjs'),'--config',fail ? 'missing.json' : 'targets.json'],{
        cwd:dir,env:{PATH:process.env.PATH,BARK_URL:'https://bark.invalid/fake-key/',BARK_ICON_URL:icon},encoding:'utf8',timeout:5000
      });
      assert.equal(result.status,fail ? 1 : 0);
      const push = JSON.parse(await readFile(path.join(dir,'push.json'),'utf8'));
      assert.equal(push.icon,icon);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
}
