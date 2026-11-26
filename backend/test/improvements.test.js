import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { calculateEventCost, invalidatePricingCache } from '../src/db/pricingEngine.js';
import { AnalyticsService } from '../src/db/analyticsQueries.js';
import { getAdapter } from '../src/adapters/index.js';
import { createOpenAIToAnthropicStream } from '../src/adapters/anthropicEgress.js';
import { OllamaService } from '../src/services/ollamaService.js';
import { executeModelAttempt, clearCircuitBreakers } from '../src/services/gatewayFailover.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-improvements-'));
  const file = path.join(dir, 'monitor.db');
  const db = new Database(file);
  initSchema(db, file);
  return { dir, db };
}

test('calculateEventCost falls back to custom_models per-1M pricing when no model_pricing rule matches', () => {
  const { dir, db } = makeTempDb();
  try {
    db.prepare(`
      INSERT INTO custom_models (model_id, display_name, provider, api_base, input_cost_per_million, output_cost_per_million)
      VALUES ('custom-priced-llm', 'Custom Priced', 'customcloud', 'https://api.example.com/v1', 2.0, 6.0)
    `).run();
    invalidatePricingCache(db);

    const res = calculateEventCost(db, {
      provider: 'customcloud',
      model: 'custom-priced-llm',
      promptTokens: 500_000,
      completionTokens: 250_000,
      status: 'success',
      timestamp: new Date().toISOString()
    });

    assert.equal(res.status, 'estimated');
    assert.equal(res.cost, 2.5); // 0.5M * $2 + 0.25M * $6 = $1 + $1.5 = $2.5
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Anthropic SSE adapters parse CRLF (\\r\\n\\r\\n) frame delimiters cleanly', async () => {
  const adapter = getAdapter('anthropic');
  const encoder = new TextEncoder();

  const crlfAnthropic = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\r\n\r\n'));
      controller.enqueue(encoder.encode('event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\r\n\r\n'));
      controller.enqueue(encoder.encode('event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\r\n\r\n'));
      controller.enqueue(encoder.encode('event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n'));
      controller.close();
    }
  });

  const openaiOut = await new Response(crlfAnthropic.pipeThrough(adapter.createStreamTransform({ model_id: 'claude-test' }))).text();
  assert.match(openaiOut, /"content":"Hi"/);
  assert.match(openaiOut, /data: \[DONE\]/);

  const crlfOpenAI = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"id":"chatcmpl-crlf","choices":[{"delta":{"content":"Ok"}}]}\r\n\r\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\r\n\r\n'));
      controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'));
      controller.close();
    }
  });

  const anthropicOut = await new Response(crlfOpenAI.pipeThrough(createOpenAIToAnthropicStream({ model: 'claude-test' }))).text();
  assert.match(anthropicOut, /"text":"Ok"/);
  assert.match(anthropicOut, /event: message_stop/);
});

test('AnalyticsService computes minute/5m time series buckets and multi-percentile summary cleanly', () => {
  const { dir, db } = makeTempDb();
  try {
    const analytics = new AnalyticsService(db);
    const stmt = db.prepare(`
      INSERT INTO usage_events (
        request_id, provider, model, call_type, status, is_streaming,
        prompt_tokens, completion_tokens, total_tokens, tokens_estimated,
        estimated_cost, cost_status, latency_ms, prompt_eval_duration_ms,
        cache_status, timestamp
      ) VALUES (?, 'ollama', 'qwen2.5:3b', 'chat.completion', 'success', 0, 10, 5, 15, 0, 0, 'estimated', ?, ?, ?, ?)
    `);

    const times = [
      '2026-11-26T10:01:10.000Z',
      '2026-11-26T10:02:20.000Z',
      '2026-11-26T10:07:30.000Z'
    ];
    times.forEach((ts, idx) => {
      stmt.run(`r-${idx}`, (idx + 1) * 100, (idx + 1) * 20, idx === 0 ? 'cache_hit' : 'standard', ts);
    });

    const summary = analytics.getSummary({});
    assert.equal(summary.totalRequests, 3);
    assert.equal(summary.latencyP50Ms, 200);
    assert.equal(summary.latencyP95Ms, 300);
    assert.equal(summary.latencyP99Ms, 300);
    assert.equal(summary.ttftP50Ms, 40);
    assert.equal(summary.cacheHitRequests, 1);
    assert.equal(summary.cacheReportedRequests, 3);

    const minuteSeries = analytics.getTimeSeries({ interval: 'minute' });
    assert.equal(minuteSeries.length, 3);
    assert.equal(minuteSeries[0].bucket, '2026-11-26T10:01:00Z');

    const fiveMinSeries = analytics.getTimeSeries({ interval: '5m' });
    assert.equal(fiveMinSeries.length, 2);
    assert.equal(fiveMinSeries[0].bucket, '2026-11-26T10:00:00Z');
    assert.equal(fiveMinSeries[0].requests, 2);
    assert.equal(fiveMinSeries[1].bucket, '2026-11-26T10:05:00Z');
    assert.equal(fiveMinSeries[1].requests, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OllamaService runTestPrompt persists benchmark runs without FK failure and calculates custom model cost', async () => {
  const { dir, db } = makeTempDb();
  const mockServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-bench',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'bench-ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }
      }));
    });
  });
  mockServer.listen(0, '127.0.0.1');
  await once(mockServer, 'listening');
  const apiBase = `http://127.0.0.1:${mockServer.address().port}/v1`;

  try {
    const svc = new OllamaService();
    svc.addCustomModel(db, {
      modelId: 'bench-cloud-model',
      displayName: 'Bench Cloud',
      provider: 'mockcloud',
      format: 'openai',
      apiBase,
      apiKey: 'secret',
      inputCostPerMillion: 1.0,
      outputCostPerMillion: 2.0
    });

    const result = await svc.runTestPrompt('bench-cloud-model', 'hello', {
      messages: [{ role: 'system', content: 'Be short' }, { role: 'user', content: 'hello' }]
    }, db);

    assert.equal(result.success, true);
    assert.equal(result.content, 'bench-ok');
    assert.equal(result.estimatedCost, 0.002); // 1000 * 1/1M + 500 * 2/1M = 0.001 + 0.001 = 0.002

    const row = db.prepare('SELECT application_id, call_type, estimated_cost, cost_status FROM usage_events ORDER BY id DESC LIMIT 1').get();
    assert.equal(row.application_id, null);
    assert.equal(row.call_type, 'playground.benchmark');
    assert.equal(row.estimated_cost, 0.002);
    assert.equal(row.cost_status, 'estimated');
  } finally {
    await new Promise((r) => mockServer.close(r));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Local Ollama routes tool calls through /v1/chat/completions and forwards options/format to /api/chat', async () => {
  const { dir, db } = makeTempDb();
  const seen = [];
  const ollamaMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/chat') {
        res.end(JSON.stringify({
          message: { role: 'assistant', content: '{"ok":true}' },
          done_reason: 'stop',
          prompt_eval_count: 10,
          eval_count: 4,
          load_duration: 1_000_000,
          prompt_eval_duration: 2_000_000,
          eval_duration: 3_000_000
        }));
        return;
      }
      res.end(JSON.stringify({
        id: 'chatcmpl-ollama-tool',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
      }));
    });
  });

  ollamaMock.listen(0, '127.0.0.1');
  await once(ollamaMock, 'listening');
  const prevOllamaUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = `http://127.0.0.1:${ollamaMock.address().port}`;
  clearCircuitBreakers();

  try {
    // 1. Standard non-streaming request uses /api/chat with forwarded options & format
    const jsonAttempt = await executeModelAttempt(db, 'qwen2.5:3b', {
      model: 'qwen2.5:3b',
      messages: [{ role: 'user', content: 'Return JSON' }],
      max_tokens: 128,
      top_p: 0.9,
      response_format: { type: 'json_object' }
    });
    assert.equal(jsonAttempt.ok, true);
    assert.equal(seen[0].url, '/api/chat');
    assert.equal(seen[0].body.format, 'json');
    assert.equal(seen[0].body.options.num_predict, 128);
    assert.equal(seen[0].body.options.top_p, 0.9);

    // 2. Non-streaming tool-call request routes to /v1/chat/completions preserving tools
    const toolAttempt = await executeModelAttempt(db, 'qwen2.5:3b', {
      model: 'qwen2.5:3b',
      messages: [{ role: 'user', content: 'Call lookup' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }]
    });
    assert.equal(toolAttempt.ok, true);
    assert.equal(seen[1].url, '/v1/chat/completions');
    assert.equal(seen[1].body.tools[0].function.name, 'lookup');
    assert.equal(toolAttempt.responseBody.choices[0].message.tool_calls[0].function.name, 'lookup');
  } finally {
    if (prevOllamaUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevOllamaUrl;
    clearCircuitBreakers();
    await new Promise((r) => ollamaMock.close(r));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Gateway records full end-to-end streaming duration instead of TTFB and exposes X-SLIR-Telemetry header', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-monitor-stream-dur-'));
  const prevDbPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, 'monitor.db');
  const { default: app, initializeDatabase } = await import(`../src/server.js?streamdur=${Date.now()}`);
  const { db } = await initializeDatabase();

  const slowStreamServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"id":"chatcmpl-slow","choices":[{"delta":{"content":"part1"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"id":"chatcmpl-slow","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }, 110);
    });
  });

  slowStreamServer.listen(0, '127.0.0.1');
  await once(slowStreamServer, 'listening');
  const mockApiBase = `http://127.0.0.1:${slowStreamServer.address().port}/v1`;

  db.prepare(`INSERT OR IGNORE INTO applications (id, name, api_key, default_model) VALUES ('app_stream_dur', 'Stream Dur', 'mp_live_stream_dur', 'slow-stream-model')`).run();
  db.prepare(`INSERT OR REPLACE INTO custom_models (model_id, display_name, provider, api_base, api_key, format) VALUES ('slow-stream-model', 'Slow Stream', 'mock', ?, 'k', 'openai')`).run(mockApiBase);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mp_live_stream_dur'
      },
      body: JSON.stringify({ model: 'slow-stream-model', stream: true, messages: [{ role: 'user', content: 'hi' }] })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-slir-telemetry'), 'recorded');
    await res.text();

    // Give persistEvent a tick after pipeline completes
    await new Promise((r) => setTimeout(r, 20));
    const event = db.prepare("SELECT latency_ms FROM usage_events WHERE application_id = 'app_stream_dur' ORDER BY id DESC LIMIT 1").get();
    assert.ok(event);
    assert.ok(event.latency_ms >= 90, `Expected full stream latency >= 90ms, got ${event.latency_ms}`);

    const sseRes = await fetch(`${baseUrl}/api/models/test-prompt/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'slow-stream-model', prompt: 'hi' })
    });
    assert.equal(sseRes.status, 200);
    const sseText = await sseRes.text();
    assert.match(sseText, /"type":"delta"/);
    assert.match(sseText, /"type":"done"/);
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => slowStreamServer.close(r));
    try { db.close(); } catch { /* ignore */ }
    if (prevDbPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AnalyticsService filters failover logs & search matches failover_trace details, and network failures capture duration & cause', async () => {
  const { dir, db } = makeTempDb();
  try {
    const analytics = new AnalyticsService(db);
    db.prepare(`
      INSERT INTO usage_events (
        request_id, provider, model, call_type, status, is_streaming,
        cost_status, latency_ms, failover_used, failover_from_model, failover_reason,
        failover_attempts, failover_trace, timestamp
      ) VALUES
        ('req-direct', 'ollama', 'qwen2.5:3b', 'chat.completion', 'success', 0, 'estimated', 42, 0, NULL, NULL, 0, NULL, '2026-11-26T12:00:00.000Z'),
        ('req-fo-ok', 'openai', 'gpt-4o-mini', 'chat.completion', 'success', 0, 'estimated', 510, 1, 'claude-sonnet', 'rate_limit', 1, '[{"model":"claude-sonnet","provider":"anthropic","outcome":"rate_limit","status":429,"durationMs":110,"message":"Quota exceeded on tier 1"},{"model":"gpt-4o-mini","provider":"openai","outcome":"success","status":200,"durationMs":400}]', '2026-11-26T12:01:00.000Z'),
        ('req-fo-fail', 'openai', 'gpt-4o-mini', 'chat.completion', 'failure', 0, 'unknown', 320, 0, 'claude-sonnet', 'upstream_5xx', 1, '[{"model":"claude-sonnet","provider":"anthropic","outcome":"upstream_5xx","status":503,"durationMs":150,"message":"Service overloaded"}]', '2026-11-26T12:02:00.000Z')
    `).run();

    assert.deepEqual(
      analytics.getRequests({ failover: 'only' }).items.map((r) => r.request_id),
      ['req-fo-fail', 'req-fo-ok']
    );
    assert.deepEqual(
      analytics.getRequests({ failover: 'used' }).items.map((r) => r.request_id),
      ['req-fo-ok']
    );
    assert.deepEqual(
      analytics.getRequests({ failover: 'failed' }).items.map((r) => r.request_id),
      ['req-fo-fail']
    );
    assert.deepEqual(
      analytics.getRequests({ failover: 'none' }).items.map((r) => r.request_id),
      ['req-direct']
    );
    assert.deepEqual(
      analytics.getRequests({ search: 'Quota exceeded on tier 1' }).items.map((r) => r.request_id),
      ['req-fo-ok']
    );

    // Closed port connection error should unwrap cause and record non-negative durationMs
    db.prepare(`
      INSERT INTO custom_models (model_id, display_name, provider, api_base, api_key, format)
      VALUES ('dead-cloud-model', 'Dead Cloud', 'mock', 'http://127.0.0.1:1/v1', 'k', 'openai')
    `).run();
    clearCircuitBreakers();
    const attempt = await executeModelAttempt(db, 'dead-cloud-model', {
      model: 'dead-cloud-model',
      messages: [{ role: 'user', content: 'hi' }]
    }, {});
    assert.equal(attempt.ok, false);
    assert.equal(attempt.reason, 'network_error');
    assert.equal(typeof attempt.durationMs, 'number');
    assert.ok(attempt.durationMs >= 0);
    assert.ok(attempt.message && attempt.message.length > 0);
  } finally {
    clearCircuitBreakers();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
