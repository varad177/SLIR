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
let lastMockHeaders = null;
let mockSeq = 0;

function latestEvent() {
  return db.prepare(`
    SELECT request_id, application_id, provider, model, call_type, status, is_streaming,
           prompt_tokens, completion_tokens, total_tokens, cost_status,
           http_status, client_model, error_type, error_message, trace_id,
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

async function messages(body, token = 'mp_live_test_key') {
  return fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(token ? { 'x-api-key': token } : {})
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
      lastMockHeaders = req.headers;
      const isAnthropic = req.url === '/v1/messages';
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

      if (isAnthropic) {
        const id = `msg_mock_${++mockSeq}`;
        if (behavior === 'tool_use') {
          const forcedTool = lastMockBody?.tool_choice?.type === 'tool'
            ? lastMockBody.tool_choice.name
            : null;
          const toolName = forcedTool || 'get_weather';
          const toolInput = toolName === 'slir_json_output' ? { answer: 'sunny' } : { city: 'Paris' };
          if (lastMockBody?.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id, usage: { input_tokens: 6, output_tokens: 1 } } })}\n\n`);
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_mock', name: toolName, input: {} } })}\n\n`);
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) } })}\n\n`);
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
            res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } })}\n\n`);
            res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id,
            type: 'message',
            role: 'assistant',
            model: lastMockBody?.model,
            content: [
              { type: 'text', text: 'Checking the weather.' },
              { type: 'tool_use', id: 'toolu_mock', name: toolName, input: toolInput }
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 6, output_tokens: 4 }
          }));
          return;
        }
        if (lastMockBody?.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id, usage: { input_tokens: 11, output_tokens: 1 } } })}\n\n`);
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } })}\n\n`);
          res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } })}\n\n`);
          res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id,
          type: 'message',
          role: 'assistant',
          model: lastMockBody?.model,
          content: [{ type: 'text', text: 'anthropic-ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 9, output_tokens: 3 }
        }));
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
    INSERT INTO custom_models (model_id, display_name, provider, api_base, api_key, format)
    VALUES (?, ?, 'mock', ?, 'mock-secret', ?)
  `);
  insertModel.run('mock-model', 'Mock Model', mockBase, 'openai');
  insertModel.run('pinned-model', 'Pinned Model', mockBase, 'openai');
  insertModel.run('fallback-model', 'Fallback Model', mockBase, 'openai');
  insertModel.run('unreachable-model', 'Unreachable Model', 'http://127.0.0.1:9/v1', 'openai');
  insertModel.run('claude-model', 'Claude Model', mockBase, 'anthropic');
  insertModel.run('claude-tools-model', 'Claude Tools Model', mockBase, 'anthropic');

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

test('metrics endpoint exposes Prometheus counters', async () => {
  const res = await fetch(`${baseUrl}/api/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.match(text, /slir_requests_total/);
  assert.match(text, /slir_uptime_seconds/);
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
  const requestId = res.headers.get('x-request-id');
  assert.match(requestId, /^req_/);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.trace_id, requestId);
  assert.equal(event.provider, 'mock');
  assert.equal(event.model, 'mock-model');
  assert.equal(event.prompt_tokens, 10);
  assert.equal(event.completion_tokens, 5);
  assert.equal(event.total_tokens, 15);
  assert.equal(event.cost_status, 'unknown');
  assert.equal(event.http_status, 200);
  assert.equal(event.client_model, 'mock-model');
});

test('model health endpoint reports recent per-model reliability', async () => {
  const res = await fetch(`${baseUrl}/api/models/health?hours=24`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.windowHours, 24);
  const model = body.models.find((item) => item.model === 'mock-model');
  assert.ok(model);
  assert.ok(model.requests >= 1);
  assert.ok(['healthy', 'degraded', 'unhealthy'].includes(model.status));
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

test('anthropic-format models are converted to and from the Messages API', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'claude-model',
    messages: [
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hello' }
    ],
    max_tokens: 32
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.choices[0].message.content, 'anthropic-ok');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.equal(body.usage.prompt_tokens, 9);
  assert.equal(body.usage.completion_tokens, 3);
  assert.equal(body.usage.total_tokens, 12);

  assert.equal(lastMockBody.system, 'You are terse.');
  assert.equal(lastMockBody.max_tokens, 32);
  assert.deepEqual(lastMockBody.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(lastMockHeaders['x-api-key'], 'mock-secret');
  assert.equal(lastMockHeaders.authorization, undefined);
  assert.equal(lastMockHeaders['anthropic-version'], '2023-06-01');

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.model, 'claude-model');
  assert.equal(event.prompt_tokens, 9);
  assert.equal(event.completion_tokens, 3);
  assert.equal(event.total_tokens, 12);
});

test('anthropic streaming responses are re-emitted as OpenAI SSE', async () => {
  mockMode = 'success';
  const res = await chat({
    model: 'claude-model',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(res.status, 200);

  const text = await res.text();
  assert.match(text, /"object":"chat\.completion\.chunk"/);
  assert.match(text, /Hello/);
  assert.match(text, /"finish_reason":"stop"/);
  assert.match(text, /"prompt_tokens":11/);
  assert.match(text, /"completion_tokens":4/);
  assert.match(text, /data: \[DONE\]/);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.is_streaming, 1);
  assert.equal(event.model, 'claude-model');
  assert.equal(event.prompt_tokens, 11);
  assert.equal(event.completion_tokens, 4);
  assert.equal(event.total_tokens, 15);
});

test('anthropic tool calls round-trip through the gateway', async () => {
  mockBehaviors['claude-tools-model'] = 'tool_use';
  const res = await chat({
    model: 'claude-tools-model',
    messages: [{ role: 'user', content: 'Weather in Paris?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city']
        }
      }
    }],
    tool_choice: 'auto'
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.content, 'Checking the weather.');
  assert.equal(body.choices[0].message.tool_calls[0].id, 'toolu_mock');
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'get_weather');
  assert.deepEqual(
    JSON.parse(body.choices[0].message.tool_calls[0].function.arguments),
    { city: 'Paris' }
  );

  assert.equal(lastMockBody.tools[0].name, 'get_weather');
  assert.equal(lastMockBody.tools[0].input_schema.type, 'object');
  assert.equal(lastMockBody.tools[0].input_schema.required[0], 'city');
  assert.deepEqual(lastMockBody.tool_choice, { type: 'auto' });
});

test('anthropic tool calls stream as OpenAI tool_call deltas through the gateway', async () => {
  mockBehaviors['claude-tools-model'] = 'tool_use';
  const res = await chat({
    model: 'claude-tools-model',
    stream: true,
    messages: [{ role: 'user', content: 'Weather in Paris?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } }
        }
      }
    }]
  });
  assert.equal(res.status, 200);

  const text = await res.text();
  assert.match(text, /"tool_calls"/);
  assert.match(text, /"name":"get_weather"/);
  assert.match(text, /"arguments":"\{\\"city\\":\\"Paris\\"\}"/);
  assert.match(text, /"finish_reason":"tool_calls"/);
  assert.match(text, /data: \[DONE\]/);
});

test('anthropic json_schema response_format returns JSON content through the gateway', async () => {
  mockBehaviors['claude-tools-model'] = 'tool_use';
  const res = await chat({
    model: 'claude-tools-model',
    messages: [{ role: 'user', content: 'Weather in Paris as JSON?' }],
    response_format: { type: 'json_object' }
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(lastMockBody.tools[0].name, 'slir_json_output');
  assert.deepEqual(lastMockBody.tool_choice, { type: 'tool', name: 'slir_json_output' });

  assert.equal(body.choices[0].message.tool_calls, undefined);
  assert.equal(typeof body.choices[0].message.content, 'string');
  assert.doesNotThrow(() => JSON.parse(body.choices[0].message.content));
});

test('native anthropic ingress returns Anthropic Messages responses', async () => {
  const res = await messages({
    model: 'claude-model',
    max_tokens: 64,
    system: 'Be terse.',
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.match(body.id, /^msg_/);
  assert.equal(body.type, 'message');
  assert.equal(body.role, 'assistant');
  assert.equal(body.model, 'claude-model');
  assert.deepEqual(body.content, [{ type: 'text', text: 'anthropic-ok' }]);
  assert.equal(body.stop_reason, 'end_turn');
  assert.deepEqual(body.usage, { input_tokens: 9, output_tokens: 3 });

  assert.equal(lastMockBody.system, 'Be terse.');
  assert.equal(lastMockBody.max_tokens, 64);
  assert.deepEqual(lastMockBody.messages, [{ role: 'user', content: 'hello' }]);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.call_type, 'anthropic.messages');
  assert.equal(event.model, 'claude-model');
  assert.equal(event.client_model, 'claude-model');
});

test('native anthropic ingress streams Anthropic SSE events', async () => {
  const res = await messages({
    model: 'claude-model',
    max_tokens: 64,
    stream: true,
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const text = await res.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /"type":"message_start"/);
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /"type":"text_delta","text":"Hello"/);
  assert.match(text, /event: message_delta/);
  assert.match(text, /"stop_reason":"end_turn"/);
  assert.match(text, /"output_tokens":4/);
  assert.match(text, /event: message_stop/);

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.call_type, 'anthropic.messages');
  assert.equal(event.is_streaming, 1);
  assert.equal(event.prompt_tokens, 11);
  assert.equal(event.completion_tokens, 4);
});

test('native anthropic ingress round-trips tool use', async () => {
  mockBehaviors['claude-tools-model'] = 'tool_use';
  const res = await messages({
    model: 'claude-tools-model',
    max_tokens: 128,
    messages: [{ role: 'user', content: 'Weather in Paris?' }],
    tools: [{
      name: 'get_weather',
      description: 'Get weather',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    }],
    tool_choice: { type: 'auto' }
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.stop_reason, 'tool_use');
  const textBlock = body.content.find((block) => block.type === 'text');
  assert.equal(textBlock.text, 'Checking the weather.');
  const toolUse = body.content.find((block) => block.type === 'tool_use');
  assert.equal(toolUse.name, 'get_weather');
  assert.deepEqual(toolUse.input, { city: 'Paris' });

  assert.equal(lastMockBody.tools[0].name, 'get_weather');
  assert.deepEqual(lastMockBody.tool_choice, { type: 'auto' });
});

test('native anthropic ingress converts tool results for the upstream', async () => {
  const res = await messages({
    model: 'claude-model',
    max_tokens: 64,
    messages: [
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_weather',
          input: { city: 'Paris' }
        }]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '18C' }]
      }
    ]
  });
  assert.equal(res.status, 200);

  assert.deepEqual(lastMockBody.messages, [
    { role: 'user', content: 'Weather?' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }]
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '18C' }]
    }
  ]);
});

test('native anthropic ingress returns Anthropic-formatted errors', async () => {
  const unauthorized = await messages({
    model: 'claude-model',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'hello' }]
  }, 'mp_live_unknown_key');
  assert.equal(unauthorized.status, 401);
  const unauthorizedBody = await unauthorized.json();
  assert.equal(unauthorizedBody.type, 'error');
  assert.equal(unauthorizedBody.error.type, 'authentication_error');

  const invalid = await messages({ model: 'claude-model', max_tokens: 8, messages: [] });
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.type, 'error');
  assert.equal(invalidBody.error.type, 'invalid_request_error');
  assert.match(invalidBody.error.message, /messages/);

  const failed = await messages({
    model: 'unreachable-model',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(failed.status, 502);
  const failedBody = await failed.json();
  assert.equal(failedBody.type, 'error');
  assert.equal(failedBody.error.type, 'api_error');
});

test('native anthropic ingress supports failover', async () => {
  mockBehaviors = { 'mock-model': 'fail' };
  const configured = await configureFailover(['fallback-model']);
  assert.equal(configured.status, 200);

  const res = await messages({
    model: 'mock-model',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.type, 'message');
  assert.deepEqual(body.content, [{ type: 'text', text: 'ok' }]);
  assert.equal(body.stop_reason, 'end_turn');
  assert.equal(lastMockBody.model, 'fallback-model');

  const event = latestEvent();
  assert.equal(event.status, 'success');
  assert.equal(event.call_type, 'anthropic.messages');
  assert.equal(event.model, 'fallback-model');
  assert.equal(event.failover_used, 1);
  assert.equal(event.failover_from_model, 'mock-model');
});

test('native anthropic ingress enforces budgets with Anthropic error shapes', async () => {
  const created = await fetch(`${baseUrl}/api/budgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ingress block budget',
      scope_type: 'application',
      application_id: 'app_test',
      period: 'daily',
      metric: 'requests',
      limit_value: 1,
      action: 'block'
    })
  });
  assert.equal(created.status, 201);
  const budgetId = (await created.json()).budget.id;
  assert.ok(budgetId);

  db.prepare(`
    INSERT INTO usage_events (
      request_id, application_id, provider, model, call_type, status,
      is_streaming, prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
      estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms, eval_duration_ms,
      load_duration_ms, cache_status, http_status, timestamp
    ) VALUES ('req-ingress-budget', 'app_test', 'mock', 'budget-model', 'anthropic.messages',
      'success', 0, 1, 1, 2, 0, 0, 'estimated', 5, NULL, NULL, NULL, 'standard', 200, ?)
  `).run(new Date().toISOString());

  try {
    const res = await messages({
      model: 'budget-model',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hello' }]
    });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, 'rate_limit_error');
    assert.match(body.error.message, /Budget "Ingress block budget" exceeded/);
  } finally {
    const deleted = await fetch(`${baseUrl}/api/budgets/${budgetId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
  }
});

test('custom models store their API format and default to openai', async () => {
  const created = await fetch(`${baseUrl}/api/models/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'anthropic-metadata',
      displayName: 'Anthropic Metadata',
      provider: 'anthropic',
      format: 'anthropic',
      apiBase: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test'
    })
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.model.format, 'anthropic');

  const defaults = await fetch(`${baseUrl}/api/models/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'default-format-model',
      displayName: 'Default Format',
      apiBase: 'http://127.0.0.1:9/v1'
    })
  });
  assert.equal(defaults.status, 200);
  const defaultsBody = await defaults.json();
  assert.equal(defaultsBody.model.format, 'openai');

  const list = await fetch(`${baseUrl}/api/models/custom`);
  assert.equal(list.status, 200);
  const models = await list.json();
  assert.equal(models.find((model) => model.modelId === 'anthropic-metadata').format, 'anthropic');

  const updated = await fetch(`${baseUrl}/api/models/custom/anthropic-metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'openai' })
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.equal(updatedBody.model.format, 'openai');

  db.prepare("DELETE FROM custom_models WHERE model_id IN ('anthropic-metadata', 'default-format-model')").run();
});

test('connection tests honor the selected API format', async () => {
  const res = await fetch(`${baseUrl}/api/models/custom/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiBase: lastMockBase,
      apiKey: 'secret',
      modelId: 'claude-model',
      format: 'anthropic'
    })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.format, 'anthropic');
  assert.equal(body.sample, 'anthropic-ok');
  assert.equal(lastMockHeaders['x-api-key'], 'secret');
  assert.equal(lastMockHeaders.authorization, undefined);
});

test('benchmark and profiler endpoints support anthropic-format models', async () => {
  const bench = await fetch(`${baseUrl}/api/models/test-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-model', prompt: 'hi' })
  });
  assert.equal(bench.status, 200);
  const benchBody = await bench.json();
  assert.equal(benchBody.content, 'anthropic-ok');
  assert.equal(benchBody.usage.promptTokens, 9);
  assert.equal(benchBody.usage.completionTokens, 3);
  assert.equal(benchBody.usage.totalTokens, 12);

  const streamed = await fetch(`${baseUrl}/api/models/test-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-model', prompt: 'hi', stream: true })
  });
  assert.equal(streamed.status, 200);
  const streamedBody = await streamed.json();
  assert.equal(streamedBody.content, 'Hello');
  assert.equal(streamedBody.usage.promptTokens, 11);
  assert.equal(streamedBody.usage.completionTokens, 4);

  const profile = await fetch(`${baseUrl}/api/models/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-model', prompt: 'hi' })
  });
  assert.equal(profile.status, 200);
  const profileBody = await profile.json();
  assert.equal(profileBody.content, 'anthropic-ok');
  assert.equal(profileBody.isCloud, true);
  assert.equal(profileBody.format, 'anthropic');
  assert.equal(profileBody.totalTokens, 12);
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
