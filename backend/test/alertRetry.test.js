import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import { sendTestAlert } from '../src/services/alertService.js';

function settingsDb(webhookUrl) {
  return {
    prepare() {
      return {
        all() {
          return [
            { key: 'alerts_webhook_url', value: webhookUrl },
            { key: 'alerts_webhook_enabled', value: 'true' }
          ];
        }
      };
    }
  };
}

test('webhook delivery retries retryable failures and succeeds on a later attempt', async () => {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts += 1;
    req.resume();
    req.on('end', () => {
      if (attempts === 1) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'temporary outage' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/webhook`;

  try {
    const result = await sendTestAlert(settingsDb(url));
    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('webhook delivery does not retry non-retryable client errors', async () => {
  let attempts = 0;
  const server = http.createServer((req, res) => {
    attempts += 1;
    req.resume();
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid payload' }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/webhook`;

  try {
    const result = await sendTestAlert(settingsDb(url));
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTP 400/);
    assert.equal(attempts, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
