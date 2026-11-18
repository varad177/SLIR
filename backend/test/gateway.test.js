import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-gateway-'));
process.env.DATABASE_PATH = path.join(tempDir, 'monitor.db');
process.env.INGEST_API_KEY = 'test-ingest-key';
process.env.RETENTION_DAYS = '0';
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
process.env.CORS_ORIGIN = 'http://localhost:3000';

const { default: app, initializeDatabase } = await import('../src/server.js');

let db;
let server;
let mockServer;
let baseUrl;
let mockMode = 'success';
let mockBehaviors = {};
let lastMockBody = null;
let lastMockBase = null;
let mockSeq = 0;

function latestEvent() {
  return db.prepare(`
    SELECT request_id, application_id, provider, model, status, is_streaming,
           prompt_tokens, completion_tokens, total_tokens, cost_status,
           http_status, client_model, error_type, error_message,
           failover_used, failover_from_model, failover_reason,
           failover_attempts, failover_trace
    FROM usage_events
    WHERE application_id = 'app_test'
    ORDER BY id DESC
    LIMIT 1
  `).get();
}

async function configureFailover(fallbackModels, enabled = true) {
  return fetch(`${baseUrl}/api/applications/app_test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failoverEnabled: enabled, fallbackModels })
  });
}

async function chat(body, token = 'mp_live_test_key') {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

before(async () => {
  const ctx = await initializeDatabase();
  db = ctx.db;

  db.prepare(`
    INSERT INTO applications (id, name, api_key, default_model)
    VALUES ('app_test', 'Test App', 'mp_live_test_key', 'pinned-model')
  `).run();

  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      lastMockBody = body ? JSON.parse(body) : null;
      const behavior = mockBehaviors[lastMockBody?.model] || mockMode;

      if (behavior === 'fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock upstream failure' }));
        return;
      }

      if (behavior === 'rate_limit') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
        return;
      }

      if (behavior === 'bad_request') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }

      const id = `chatcmpl-mock-${++mockSeq}`;

      if (lastMockBody?.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { content: 'hi' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    });
  });
  mockServer.listen(0, '127.0.0.1');
  await once(mockServer, 'listening');
  const mockBase = `http://127.0.0.1:${mockServer.address().port}/v1`;
  lastMockBase = mockBase;

  const insertModel = db.prepare(`
    INSERT INTO custom_models (model_id, display_name, provider, api_base, api_key)
    VALUES (?, ?, 'mock', ?, 'mock-secret')
  `);
  insertModel.run('mock-model', 'Mock Model', mockBase);
  insertModel.run('pinned-model', 'Pinned Model', mockBase);
  insertModel.run('fallback-model', 'Fallback Model', mockBase);
  insertModel.run('unreachable-model', 'Unreachable Model', 'http://127.0.0.1:9/v1');

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
  if (db) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  mockMode = 'success';
  mockBehaviors = {};
  db.prepare("UPDATE applications SET failover_enabled = 0, fallback_models = '[]' WHERE id = 'app_test'").run();
});

test('health endpoint reports a live database', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.dbType, 'better-sqlite3');
});

test('gateway config normalizes public base URL', async () => {
  const original = process.env.SLIR_PUBLIC_BASE_URL;
  process.env.SLIR_PUBLIC_BASE_URL = 'https://ai.example.com/gateway';
  try {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.publicBaseUrl, 'https://ai.example.com/gateway/v1');
    assert.equal(typeof body.gatewayPort, 'number');
  } finally {
    if (original === undefined) {
      delete process.env.SLIR_PUBLIC_BASE_URL;
    } else {
      process.env.SLIR_PUBLIC_BASE_URL = original;
    }
  }
});

test('gateway config returns null when public base URL not set', async () => {
  const original = process.env.SLIR_PUBLIC_BASE_URL;
  delete process.env.SLIR_PUBLIC_BASE_URL;
  try {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.publicBaseUrl, null);
    assert.equal(typeof body.gatewayPort, 'number');
  } finally {
    if (original !== undefined) {
      process.env.SLIR_PUBLIC_BASE_URL = original;
    }
  }
});

test('unknown application keys are rejected without telemetry', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
  const res = await chat({ model: 'mock-model', messages: [] }, 'mp_live_unknown');
  assert.equal(res.status, 401);

  const after = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
  assert.equal(after, before);
});

test('successful cloud calls are persisted with provider usage', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'mock-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.provider, 'mock');
  assert.equal(event.model, 'mock-model');
  assert.equal(event.prompt_tokens, 10);
  assert.equal(event.completion_tokens, 5);
  assert.equal(event.total_tokens, 15);
  assert.equal(event.cost_status, 'unknown');
  assert.equal(event.http_status, 200);
  assert.equal(event.client_model, 'mock-model');
});

test('active-model honours the application default model', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'active-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.model, 'pinned-model');
  const event = latestEvent();
  assert.equal(event.model, 'pinned-model');
  assert.equal(event.client_model, 'active-model');
});

test('failed upstream calls are persisted as failures', async () => {
  mockMode = 'fail';
  const res = await chat({
    model: 'mock-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 500);

  const event = latestEvent();
  assert.equal(event.status, 'failure');
  assert.equal(event.error_type, 'upstream_500');
  assert.match(event.error_message, /mock upstream failure/);
  assert.equal(event.prompt_tokens, null);
  assert.equal(event.total_tokens, null);
  assert.equal(event.http_status, 500);
});

test('streaming cloud calls request usage and persist final token counts', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'mock-model',
    stream: true,
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.stream_options.include_usage, true);

  const text = await res.text();
  assert.match(text, /chatcmpl-mock-\d+/);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.is_streaming, 1);
  assert.equal(event.prompt_tokens, 7);
  assert.equal(event.completion_tokens, 3);
  assert.equal(event.total_tokens, 10);
});

test('application failover settings are validated and returned', async () => {
  const saved = await configureFailover([' ollama/fallback-model ', 'fallback-model']);
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.application.failoverEnabled, true);
  assert.deepEqual(body.application.fallbackModels, ['fallback-model']);

  const list = await fetch(`${baseUrl}/api/applications`);
  const listBody = await list.json();
  const app = listBody.applications.find((item) => item.id === 'app_test');
  assert.equal(app.failoverEnabled, true);
  assert.deepEqual(app.fallbackModels, ['fallback-model']);

  const alias = await configureFailover(['active-model']);
  assert.equal(alias.status, 400);

  const tooMany = await configureFailover(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(tooMany.status, 400);
});

test('rate-limited cloud calls fail over to the next application model', async () => {
  mockBehaviors = { 'mock-model': 'rate_limit' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await chat({
    model: 'mock-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.model, 'fallback-model');

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.model, 'fallback-model');
  assert.equal(event.failover_used, 1);
  assert.equal(event.failover_from_model, 'mock-model');
  assert.equal(event.failover_reason, 'rate_limit');
  assert.equal(event.failover_attempts, 1);
  assert.match(event.failover_trace, /rate_limit/);
  assert.match(event.failover_trace, /success/);
});

test('provider 5xx failures fail over to the next application model', async () => {
  mockBehaviors = { 'mock-model': 'fail' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'mock-model', messages: [] });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.model, 'fallback-model');

  const event = latestEvent();
  assert.equal(event.model, 'fallback-model');
  assert.equal(event.failover_reason, 'upstream_5xx');
  assert.equal(event.failover_attempts, 1);
});

test('network failures fail over to the next application model', async () => {
  const configured = await configureFailover(['mock-model']);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'unreachable-model', messages: [] });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.model, 'mock-model');

  const event = latestEvent();
  assert.equal(event.model, 'mock-model');
  assert.equal(event.failover_reason, 'network_error');
  assert.equal(event.failover_used, 1);
});

test('streaming requests fail over before the stream starts', async () => {
  mockBehaviors = { 'mock-model': 'rate_limit' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'mock-model', stream: true, messages: [] });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /chatcmpl-mock-\d+/);
  assert.equal(lastMockBody.model, 'fallback-model');

  const event = latestEvent();
  assert.equal(event.is_streaming, 1);
  assert.equal(event.model, 'fallback-model');
  assert.equal(event.failover_used, 1);
});

test('non-retryable upstream errors do not fail over', async () => {
  mockBehaviors = { 'mock-model': 'bad_request' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'mock-model', messages: [] });
  assert.equal(res.status, 400);
  assert.equal(lastMockBody.model, 'mock-model');

  const event = latestEvent();
  assert.equal(event.status, 'failure');
  assert.equal(event.model, 'mock-model');
  assert.equal(event.failover_attempts, 0);
  assert.equal(event.failover_used, 0);
});

test('all failed fallback attempts produce one failure row with a trace', async () => {
  mockBehaviors = { 'mock-model': 'rate_limit', 'fallback-model': 'fail' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'mock-model', messages: [] });
  assert.equal(res.status, 500);

  const event = latestEvent();
  assert.equal(event.status, 'failure');
  assert.equal(event.model, 'fallback-model');
  assert.equal(event.failover_used, 0);
  assert.equal(event.failover_attempts, 1);
  assert.equal(event.failover_from_model, 'mock-model');
  assert.match(event.failover_trace, /rate_limit/);
  assert.match(event.failover_trace, /upstream_5xx/);
});

test('disabled failover leaves the original request unchanged', async () => {
  mockBehaviors = { 'mock-model': 'rate_limit' };
  const configured = await configureFailover(['fallback-model'], false);
  assert.equal(configured.status, 200);

  const res = await chat({ model: 'mock-model', messages: [] });
  assert.equal(res.status, 429);

  const event = latestEvent();
  assert.equal(event.status, 'failure');
  assert.equal(event.model, 'mock-model');
  assert.equal(event.failover_attempts, 0);
  assert.equal(event.failover_used, 0);
});

test('non-string model values are rejected', async () => {
  const res = await chat({ model: ['mock-model'], messages: [] });
  assert.equal(res.status, 400);
});

test('applications can be pinned to a model and returned to the global fallback', async () => {
  const pinned = await fetch(`${baseUrl}/api/applications/app_test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultModel: 'mock-model' })
  });
  assert.equal(pinned.status, 200);
  const pinnedBody = await pinned.json();
  assert.equal(pinnedBody.application.defaultModel, 'mock-model');
  assert.equal(pinnedBody.application.routingMode, 'pinned');

  const list = await fetch(`${baseUrl}/api/applications`);
  const listBody = await list.json();
  const app = listBody.applications.find((item) => item.id === 'app_test');
  assert.equal(app.routingMode, 'pinned');

  const global = await fetch(`${baseUrl}/api/applications/app_test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultModel: 'active-model' })
  });
  assert.equal(global.status, 200);
  const globalBody = await global.json();
  assert.equal(globalBody.application.defaultModel, 'active-model');
  assert.equal(globalBody.application.routingMode, 'global');

  const invalid = await fetch(`${baseUrl}/api/applications/app_test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '   ' })
  });
  assert.equal(invalid.status, 400);

  const missing = await fetch(`${baseUrl}/api/applications/does_not_exist`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultModel: 'mock-model' })
  });
  assert.equal(missing.status, 404);

  db.prepare("UPDATE applications SET default_model = 'pinned-model' WHERE id = 'app_test'").run();
});

test('custom model metadata is created, updated, and deleted without exposing keys', async () => {
  const created = await fetch(`${baseUrl}/api/models/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'metadata-model',
      displayName: 'Metadata Model',
      provider: 'mock',
      apiBase: 'http://127.0.0.1:9/v1',
      apiKey: 'test-secret-key',
      contextWindow: 8192,
      maxOutputTokens: 2048,
      inputCostPerMillion: 0.5,
      outputCostPerMillion: 1.5,
      timeoutMs: 25000
    })
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.model.contextWindow, 8192);
  assert.equal(createdBody.model.maxOutputTokens, 2048);
  assert.equal(createdBody.model.timeoutMs, 25000);
  assert.equal(createdBody.model.hasApiKey, true);
  assert.equal(JSON.stringify(createdBody).includes('test-secret-key'), false);

  const updated = await fetch(`${baseUrl}/api/models/custom/metadata-model`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Renamed Model', contextWindow: 16384, keepApiKey: true })
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.model.displayName, 'Renamed Model');
  assert.equal(updatedBody.model.contextWindow, 16384);
  assert.equal(updatedBody.model.hasApiKey, true);
  assert.equal(updatedBody.model.provider, 'mock');

  const unknown = await fetch(`${baseUrl}/api/models/custom/not-a-model`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Nope' })
  });
  assert.equal(unknown.status, 404);

  const removed = await fetch(`${baseUrl}/api/models/custom/metadata-model`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.equal(removedBody.deleted, 'metadata-model');
});

test('unsaved and stored model connections can be tested', async () => {
  const unsaved = await fetch(`${baseUrl}/api/models/custom/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiBase: lastMockBase, apiKey: 'secret', modelId: 'mock-model' })
  });
  assert.equal(unsaved.status, 200);
  const unsavedBody = await unsaved.json();
  assert.equal(unsavedBody.ok, true);
  assert.equal(unsavedBody.httpStatus, 200);

  const stored = await fetch(`${baseUrl}/api/models/custom/mock-model/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(stored.status, 200);
  const storedBody = await stored.json();
  assert.equal(storedBody.ok, true);

  const missing = await fetch(`${baseUrl}/api/models/custom/not-a-model/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(missing.status, 404);
});
