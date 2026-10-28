import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CasError, createCasClient } from '../src/casClient.mjs';

test('retries a transient 504 response and returns the next successful response', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    if (requests === 1) {
      return new Response('{"message":"temporary gateway timeout"}', { status: 504 });
    }
    return new Response('{"code":200,"data":"ok"}', { status: 200 });
  });

  const client = createCasClient({ baseUrl: 'https://example.invalid', retryDelayMs: 0 });
  const result = await client.request('/test');

  assert.equal(requests, 2);
  assert.deepEqual(result, { code: 200, data: 'ok' });
});

test('does not retry an authentication failure', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response('{"message":"expired"}', { status: 401, statusText: 'Unauthorized' });
  });

  const client = createCasClient({ baseUrl: 'https://example.invalid', retryDelayMs: 0 });
  await assert.rejects(client.request('/test'), error => {
    assert.ok(error instanceof CasError);
    assert.match(error.message, /401 Unauthorized/);
    return true;
  });
  assert.equal(requests, 1);
});
