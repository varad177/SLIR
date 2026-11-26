import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, normalizeFormat, joinEndpoint, SUPPORTED_FORMATS } from '../src/adapters/index.js';

test('joinEndpoint appends paths without duplicating /v1', () => {
  assert.equal(
    joinEndpoint('https://api.anthropic.com', '/v1/messages'),
    'https://api.anthropic.com/v1/messages'
  );
  assert.equal(
    joinEndpoint('https://api.anthropic.com/v1', '/v1/messages'),
    'https://api.anthropic.com/v1/messages'
  );
  assert.equal(
    joinEndpoint('https://api.openai.com/v1/', '/chat/completions'),
    'https://api.openai.com/v1/chat/completions'
  );
});

test('normalizeFormat falls back to openai for unknown values', () => {
  assert.deepEqual(SUPPORTED_FORMATS, ['openai', 'anthropic']);
  assert.equal(normalizeFormat('ANTHROPIC'), 'anthropic');
  assert.equal(normalizeFormat(' openai '), 'openai');
  assert.equal(normalizeFormat('gemini'), 'openai');
  assert.equal(normalizeFormat(''), 'openai');
  assert.equal(normalizeFormat(undefined), 'openai');
});

test('openai adapter passes requests through and requests stream usage', () => {
  const adapter = getAdapter('openai');
  const body = adapter.buildRequestBody(
    { model: 'alias', messages: [], stream: true },
    { model_id: 'real-model' }
  );
  assert.equal(body.model, 'real-model');
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(adapter.createStreamTransform({}), null);
  assert.deepEqual(adapter.buildHeaders('sk-test'), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer sk-test'
  });
});

test('anthropic adapter converts OpenAI requests to Messages API requests', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    model: 'ignored',
    messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'How are you?' },
          { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }
        ]
      }
    ],
    temperature: 1.7,
    max_tokens: 64,
    stop: 'END',
    stream: true
  }, { model_id: 'claude-test', max_output_tokens: 1024 });

  assert.equal(body.model, 'claude-test');
  assert.equal(body.system, 'Be brief.');
  assert.equal(body.max_tokens, 64);
  assert.equal(body.temperature, 1);
  assert.deepEqual(body.stop_sequences, ['END']);
  assert.equal(body.stream, true);
  assert.equal(body.response_format, undefined);
  assert.equal(body.stream_options, undefined);
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'How are you?' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/cat.png' } }
      ]
    }
  ]);
});

test('anthropic adapter defaults max_tokens and uses native auth headers', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({ messages: [{ role: 'user', content: 'hi' }] }, { model_id: 'claude-test' });
  assert.equal(body.max_tokens, 4096);

  const configured = adapter.buildRequestBody(
    { messages: [{ role: 'user', content: 'hi' }] },
    { model_id: 'claude-test', max_output_tokens: 2048 }
  );
  assert.equal(configured.max_tokens, 2048);

  const headers = adapter.buildHeaders('sk-ant-test');
  assert.equal(headers['x-api-key'], 'sk-ant-test');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers.Authorization, undefined);
});

test('anthropic adapter converts responses to OpenAI chat completions', () => {
  const adapter = getAdapter('anthropic');
  const transformed = adapter.transformResponse({
    id: 'msg_abc',
    type: 'message',
    content: [{ type: 'text', text: 'Hi there' }],
    stop_reason: 'max_tokens',
    usage: {
      input_tokens: 8,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 2,
      output_tokens: 3
    }
  }, { model_id: 'claude-test' });

  assert.equal(transformed.id, 'chatcmpl-abc');
  assert.equal(transformed.object, 'chat.completion');
  assert.equal(transformed.model, 'claude-test');
  assert.equal(transformed.choices[0].message.role, 'assistant');
  assert.equal(transformed.choices[0].message.content, 'Hi there');
  assert.equal(transformed.choices[0].finish_reason, 'length');
  assert.equal(transformed.usage.prompt_tokens, 14);
  assert.equal(transformed.usage.completion_tokens, 3);
  assert.equal(transformed.usage.total_tokens, 17);
  assert.equal(transformed.usage.prompt_tokens_details.cached_tokens, 4);
  assert.equal(adapter.cacheStatus(transformed), 'cache_hit');
});

test('anthropic stream transform emits OpenAI chunks, usage, and DONE', async () => {
  const adapter = getAdapter('anthropic');
  const transform = adapter.createStreamTransform({ model_id: 'claude-test' });
  const encoder = new TextEncoder();
  const first = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"cache_read_input_tokens":2,"output_tokens":1}}}\n\n';
  const second = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel';
  const third = 'lo"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n';
  const fourth = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(first));
      controller.enqueue(encoder.encode(second));
      controller.enqueue(encoder.encode(third));
      controller.enqueue(encoder.encode(fourth));
      controller.close();
    }
  });

  const output = await new Response(source.pipeThrough(transform)).text();
  assert.match(output, /"object":"chat\.completion\.chunk"/);
  assert.match(output, /"role":"assistant"/);
  assert.match(output, /"content":"Hello"/);
  assert.match(output, /"finish_reason":"stop"/);
  assert.match(output, /"prompt_tokens":12/);
  assert.match(output, /"completion_tokens":5/);
  assert.match(output, /"total_tokens":17/);
  assert.match(output, /data: \[DONE\]/);
});

function parseSse(text) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice(6))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload));
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

test('anthropic adapter converts OpenAI tools and tool_choice', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'What is the weather?' }],
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
  }, { model_id: 'claude-test' });

  assert.deepEqual(body.tools, [{
    name: 'get_weather',
    description: 'Get weather for a city',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city']
    }
  }]);
  assert.deepEqual(body.tool_choice, { type: 'auto' });
});

test('anthropic adapter maps forced and disabled tool choices', () => {
  const adapter = getAdapter('anthropic');
  const tools = [{ type: 'function', function: { name: 'lookup' } }];

  const forced = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    tool_choice: { type: 'function', function: { name: 'lookup' } }
  }, { model_id: 'claude-test' });
  assert.deepEqual(forced.tool_choice, { type: 'tool', name: 'lookup' });
  assert.equal(forced.tools[0].input_schema.type, 'object');

  const required = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    tool_choice: 'required'
  }, { model_id: 'claude-test' });
  assert.deepEqual(required.tool_choice, { type: 'any' });

  const none = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    tools,
    tool_choice: 'none'
  }, { model_id: 'claude-test' });
  assert.equal(none.tools, undefined);
  assert.equal(none.tool_choice, undefined);
});

test('anthropic adapter supports legacy functions and parallel_tool_calls', () => {
  const adapter = getAdapter('anthropic');

  const legacy = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    functions: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
    function_call: { name: 'lookup' }
  }, { model_id: 'claude-test' });
  assert.equal(legacy.tools[0].name, 'lookup');
  assert.deepEqual(legacy.tool_choice, { type: 'tool', name: 'lookup' });

  const serial = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'lookup' } }],
    tool_choice: 'auto',
    parallel_tool_calls: false
  }, { model_id: 'claude-test' });
  assert.deepEqual(serial.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
});

test('anthropic adapter converts tool calls and tool results into Messages turns', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    messages: [
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
        }]
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp":18}' },
      { role: 'tool', tool_call_id: 'call_2', content: '{"temp":21}' },
      { role: 'user', content: 'Thanks!' }
    ]
  }, { model_id: 'claude-test' });

  assert.deepEqual(body.messages, [
    { role: 'user', content: 'Weather in Paris?' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } }]
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: '{"temp":18}' },
        { type: 'tool_result', tool_use_id: 'call_2', content: '{"temp":21}' },
        { type: 'text', text: 'Thanks!' }
      ]
    }
  ]);
});

test('anthropic adapter converts tool_use blocks to OpenAI tool_calls', () => {
  const adapter = getAdapter('anthropic');
  const transformed = adapter.transformResponse({
    id: 'msg_tool',
    content: [
      { type: 'text', text: 'Checking...' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 2 }
  }, { model_id: 'claude-test' });

  assert.equal(transformed.choices[0].finish_reason, 'tool_calls');
  assert.equal(transformed.choices[0].message.content, 'Checking...');
  assert.deepEqual(transformed.choices[0].message.tool_calls, [{
    id: 'toolu_1',
    type: 'function',
    function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
  }]);
});

test('anthropic stream transform emits OpenAI tool_call deltas', async () => {
  const adapter = getAdapter('anthropic');
  const transform = adapter.createStreamTransform({ model_id: 'claude-test' });
  const source = streamFrom([
    'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"Paris\\"}"}}\n\n',
    'data: {"type":"content_block_stop","index":0}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
    'data: {"type":"message_stop"}\n\n'
  ]);

  const output = await new Response(source.pipeThrough(transform)).text();
  const chunks = parseSse(output);
  const toolDeltas = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
  assert.equal(toolDeltas[0].id, 'toolu_1');
  assert.equal(toolDeltas[0].type, 'function');
  assert.equal(toolDeltas[0].function.name, 'get_weather');
  const args = toolDeltas.map((delta) => delta.function?.arguments || '').join('');
  assert.equal(args, '{"city":"Paris"}');
  const final = chunks.find((chunk) => chunk.choices?.[0]?.finish_reason === 'tool_calls');
  assert.ok(final);
  assert.equal(final.usage.total_tokens, 15);
  assert.match(output, /data: \[DONE\]/);
});

test('anthropic adapter converts image parts to image blocks', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }
      ]
    }]
  }, { model_id: 'claude-test' });

  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: 'What is this?' },
    { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
  ]);
});

test('anthropic adapter forwards cache_control on system and user messages', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    messages: [
      { role: 'system', content: 'Long instructions', cache_control: { type: 'ephemeral' } },
      { role: 'user', content: 'Hi', cache_control: { type: 'ephemeral' } }
    ]
  }, { model_id: 'claude-test' });

  assert.deepEqual(body.system, [{
    type: 'text',
    text: 'Long instructions',
    cache_control: { type: 'ephemeral' }
  }]);
  assert.deepEqual(body.messages[0].content, [{
    type: 'text',
    text: 'Hi',
    cache_control: { type: 'ephemeral' }
  }]);
});

test('anthropic adapter forwards native parameters', () => {
  const adapter = getAdapter('anthropic');
  const body = adapter.buildRequestBody({
    messages: [{ role: 'user', content: 'hi' }],
    top_k: 5,
    metadata: { user_id: 'u1' },
    thinking: { type: 'enabled', budget_tokens: 1024 }
  }, { model_id: 'claude-test' });

  assert.equal(body.top_k, 5);
  assert.deepEqual(body.metadata, { user_id: 'u1' });
  assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 1024 });
});

test('anthropic adapter implements json_schema via a forced output tool', () => {
  const adapter = getAdapter('anthropic');
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer']
  };
  const requestBody = {
    messages: [{ role: 'user', content: 'Reply as JSON' }],
    response_format: { type: 'json_schema', json_schema: { name: 'reply', schema } }
  };
  const body = adapter.buildRequestBody(requestBody, { model_id: 'claude-test' });

  assert.equal(body.response_format, undefined);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'slir_json_output' });
  assert.equal(body.tools.at(-1).input_schema, schema);

  const transformed = adapter.transformResponse({
    id: 'msg_json',
    content: [{ type: 'tool_use', id: 'toolu_j', name: 'slir_json_output', input: { answer: 'yes' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 3, output_tokens: 4 }
  }, { model_id: 'claude-test' }, requestBody);

  assert.equal(transformed.choices[0].finish_reason, 'stop');
  assert.equal(transformed.choices[0].message.content, '{"answer":"yes"}');
  assert.equal(transformed.choices[0].message.tool_calls, undefined);
});

test('anthropic stream transform streams forced json output as content', async () => {
  const adapter = getAdapter('anthropic');
  const requestBody = { response_format: { type: 'json_object' } };
  const transform = adapter.createStreamTransform({ model_id: 'claude-test' }, requestBody);
  const source = streamFrom([
    'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":1}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Here you go: "}}\n\n',
    'data: {"type":"content_block_stop","index":0}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_j","name":"slir_json_output","input":{}}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"ok\\":"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"true}"}}\n\n',
    'data: {"type":"content_block_stop","index":1}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n',
    'data: {"type":"message_stop"}\n\n'
  ]);

  const output = await new Response(source.pipeThrough(transform)).text();
  const chunks = parseSse(output);
  const content = chunks.map((chunk) => chunk.choices?.[0]?.delta?.content || '').join('');
  assert.equal(content, '{"ok":true}');
  assert.equal(chunks.some((chunk) => chunk.choices?.[0]?.delta?.tool_calls), false);
  assert.ok(chunks.find((chunk) => chunk.choices?.[0]?.finish_reason === 'stop'));
  assert.match(output, /data: \[DONE\]/);
});
