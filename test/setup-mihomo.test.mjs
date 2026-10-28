import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('downloads an explicit Mihomo version without calling the anonymous release API', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'mihomo-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const binDir = path.join(temp, 'bin');
  const curlLog = path.join(temp, 'curl.log');
  await mkdir(binDir);

  const fakeMihomo = '#!/bin/sh\nwhile :; do sleep 1; done\n';
  const archive = path.join(temp, 'mihomo.gz');
  await writeFile(archive, gzipSync(fakeMihomo));
  const fakeCurl = path.join(binDir, 'curl');
  await writeFile(fakeCurl, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
case "$*" in
  *api.github.com*) exit 22 ;;
  *releases/download/v9.9.9/mihomo-linux-amd64-v1-v9.9.9.gz*)
    previous=''
    for argument in "$@"; do
      if [ "$previous" = '-o' ]; then cp "$FAKE_MIHOMO_GZ" "$argument"; exit 0; fi
      previous="$argument"
    done
    exit 2
    ;;
  *--proxy*) exit 0 ;;
esac
exit 22
`);
  await chmod(fakeCurl, 0o755);

  const output = path.join(temp, 'github-output');
  const result = await run('bash', ['scripts/setup-mihomo.sh'], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: output,
      CLASH_CONFIG_YAML: 'proxies: []',
      CLASH_SUBSCRIPTION_URL: '',
      MIHOMO_VERSION: 'v9.9.9',
      FAKE_CURL_LOG: curlLog,
      FAKE_MIHOMO_GZ: archive
    }
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const requests = await readFile(curlLog, 'utf8');
  assert.doesNotMatch(requests, /api\.github\.com/);
  assert.match(requests, /releases\/download\/v9\.9\.9\/mihomo-linux-amd64-v1-v9\.9\.9\.gz/);
  assert.match(await readFile(output, 'utf8'), /proxy=http:\/\/127\.0\.0\.1:7890/);

  const pid = Number(await readFile(path.join(temp, 'mihomo', 'mihomo.pid'), 'utf8'));
  try { process.kill(pid); } catch {}
});

function run(command, args, options) {
  return new Promise(resolve => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
