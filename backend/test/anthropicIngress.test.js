import test from 'node:test';
import assert from 'node:assert/strict';
import { anthropicToOpenAI, formatAnthropicError } from '../src/adapters/anthropicIngress.js';
import { openAIToAnthropicResponse, createOpenAIToAnthropicStream } from '../src/adapters/anthropicEgress.js';

function parseAnthropicEvents(text) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
      return { event, data: data ? JSON.parse(data) : null };
    });
}

function streamFrom(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    }
  });
}

test('anthropicToOpenAI converts system, messages, and parameters', () => {
  const openai = anthropicToOpenAI({
    model: 'claude-test',
    max_tokens: 128,
    temperature: 0.4,
    top_p: 0.9,
    stop_sequences: ['END'],
    system: 'Be terse.',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'user', content: 'How are you?' }
    ]
  });

  assert.equal(openai.model, 'claude-test');
  assert.equal(openai.max_tokens, 128);
  assert.equal(openai.temperature, 0.4);
  assert.equal(openai.top_p, 0.9);
  assert.deepEqual(openai.stop, ['END']);
  assert.equal(openai.stream, false);
  assert.deepEqual(openai.messages, [
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
    { role: 'user', content: 'How are you?' }
  ]);
});

test('anthropicToOpenAI converts tools, tool_choice, and native params', () => {
  const openai = anthropicToOpenAI({
    model: 'claude-test',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{
      name: 'get_weather',
      description: 'Get weather',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } }
    }],
    tool_choice: { type: 'tool', name: 'get_weather' },
    top_k: 7,
    metadata: { user_id: 'u1' },
    thinking: { type: 'enabled', budget_tokens: 1024 }
  });

  assert.deepEqual(openai.tools, [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } }
    }
  }]);
  assert.deepEqual(openai.tool_choice, { type: 'function', function: { name: 'get_weather' } });
  assert.deepEqual(openai._anthropic_native, {
    top_k: 7,
    metadata: { user_id: 'u1' },
    thinking: { type: 'enabled', budget_tokens: 1024 }
  });
});

test('anthropicToOpenAI converts tool_use and tool_result turns', () => {
  const openai = anthropicToOpenAI({
    model: 'claude-test',
    max_tokens: 64,
    messages: [
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '18C' },
          { type: 'text', text: 'Thanks' }
        ]
      }
    ]
  });

  assert.deepEqual(openai.messages, [
    { role: 'user', content: 'Weather?' },
    {
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [{
        id: 'toolu_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
      }]
    },
    { role: 'tool', tool_call_id: 'toolu_1', content: '18C' },
    { role: 'user', content: 'Thanks' }
  ]);
});

test('anthropicToOpenAI converts image blocks to image_url parts', () => {
  const openai = anthropicToOpenAI({
    model: 'claude-test',
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
      ]
    }]
  });

  assert.deepEqual(openai.messages[0].content, [
    { type: 'text', text: 'What is this?' },
    { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }
  ]);
});

test('anthropicToOpenAI rejects missing messages', () => {
  assert.throws(() => anthropicToOpenAI({ model: 'claude-test' }), /non-empty array/);
  assert.throws(() => anthropicToOpenAI({ messages: [] }), /non-empty array/);
});

test('openAIToAnthropicResponse converts text, usage, and stop reason', () => {
  const message = openAIToAnthropicResponse({
    id: 'chatcmpl-abc',
    choices: [{
      message: { role: 'assistant', content: 'Hi there' },
      finish_reason: 'length'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4 }
  }, { model: 'claude-test' });

  assert.equal(message.id, 'msg_abc');
  assert.equal(message.type, 'message');
  assert.equal(message.role, 'assistant');
  assert.equal(message.model, 'claude-test');
  assert.deepEqual(message.content, [{ type: 'text', text: 'Hi there' }]);
  assert.equal(message.stop_reason, 'max_tokens');
  assert.equal(message.stop_sequence, null);
  assert.deepEqual(message.usage, { input_tokens: 10, output_tokens: 4 });
});

test('openAIToAnthropicResponse converts tool_calls to tool_use blocks', () => {
  const message = openAIToAnthropicResponse({
    id: 'chatcmpl-tool',
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
        }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 5, completion_tokens: 2 }
  }, { model: 'claude-test' });

  assert.equal(message.stop_reason, 'tool_use');
  assert.deepEqual(message.content, [{
    type: 'tool_use',
    id: 'call_1',
    name: 'get_weather',
    input: { city: 'Paris' }
  }]);
});

test('createOpenAIToAnthropicStream converts text chunks into Anthropic events', async () => {
  const transform = createOpenAIToAnthropicStream({ model: 'claude-test' });
  const source = streamFrom([
    'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    'data: [DONE]\n\n'
  ]);

  const output = await new Response(source.pipeThrough(transform)).text();
  const events = parseAnthropicEvents(output);

  const start = events.find((e) => e.event === 'message_start');
  assert.equal(start.data.message.id, 'msg_1');
  assert.equal(start.data.message.model, 'claude-test');
  assert.equal(start.data.message.role, 'assistant');

  const textDeltas = events
    .filter((e) => e.event === 'content_block_delta')
    .map((e) => e.data.delta.text)
    .join('');
  assert.equal(textDeltas, 'Hello');

  const delta = events.find((e) => e.event === 'message_delta');
  assert.equal(delta.data.delta.stop_reason, 'end_turn');
  assert.equal(delta.data.usage.output_tokens, 5);

  assert.ok(events.find((e) => e.event === 'message_stop'));
});

test('createOpenAIToAnthropicStream converts tool call chunks', async () => {
  const transform = createOpenAIToAnthropicStream({ model: 'claude-test' });
  const source = streamFrom([
    'data: {"id":"chatcmpl-t","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Paris\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":6,"completion_tokens":4}}\n\n',
    'data: [DONE]\n\n'
  ]);

  const output = await new Response(source.pipeThrough(transform)).text();
  const events = parseAnthropicEvents(output);

  const toolStart = events.find((e) => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use');
  assert.equal(toolStart.data.content_block.id, 'call_1');
  assert.equal(toolStart.data.content_block.name, 'get_weather');

  const partial = events
    .filter((e) => e.event === 'content_block_delta' && e.data.delta.type === 'input_json_delta')
    .map((e) => e.data.delta.partial_json)
    .join('');
  assert.equal(partial, '{"city":"Paris"}');

  const delta = events.find((e) => e.event === 'message_delta');
  assert.equal(delta.data.delta.stop_reason, 'tool_use');
  assert.equal(delta.data.usage.output_tokens, 4);
});

test('formatAnthropicError maps HTTP statuses to Anthropic error types', () => {
  assert.equal(formatAnthropicError(401, { error: { message: 'nope' } }).error.type, 'authentication_error');
  assert.equal(formatAnthropicError(400, { error: { message: 'bad' } }).error.type, 'invalid_request_error');
  assert.equal(formatAnthropicError(404, { error: { message: 'gone' } }).error.type, 'not_found_error');
  assert.equal(formatAnthropicError(429, { error: { message: 'slow' } }).error.type, 'rate_limit_error');
  assert.equal(formatAnthropicError(500, { error: { message: 'boom' } }).error.type, 'api_error');
  assert.equal(formatAnthropicError(502, { error: { message: 'boom' } }).type, 'error');
});
