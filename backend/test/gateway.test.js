import test, { before, after } from 'node:test';
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
let lastMockBody = null;
let mockSeq = 0;

function latestEvent() {
  return db.prepare(`
    SELECT request_id, application_id, provider, model, status, is_streaming,
           prompt_tokens, completion_tokens, total_tokens, cost_status,
           error_type, error_message
    FROM usage_events
    WHERE application_id = 'app_test'
    ORDER BY id DESC
    LIMIT 1
  `).get();
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

      if (mockMode === 'fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mock upstream failure' }));
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

  const insertModel = db.prepare(`
    INSERT INTO custom_models (model_id, display_name, provider, api_base, api_key)
    VALUES (?, ?, 'mock', ?, 'mock-secret')
  `);
  insertModel.run('mock-model', 'Mock Model', mockBase);
  insertModel.run('pinned-model', 'Pinned Model', mockBase);

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

test('health endpoint reports a live database', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.dbType, 'better-sqlite3');
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
});

test('active-model honours the application default model', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'active-model',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);
  assert.equal(lastMockBody.model, 'pinned-model');
  assert.equal(latestEvent().model, 'pinned-model');
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

test('non-string model values are rejected', async () => {
  const res = await chat({ model: ['mock-model'], messages: [] });
  assert.equal(res.status, 400);
});
