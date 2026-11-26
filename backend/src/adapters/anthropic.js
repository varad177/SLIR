import { BaseAdapter } from './base.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;
const JSON_OUTPUT_TOOL = 'slir_json_output';

const STOP_REASON_MAP = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  pause_turn: 'stop',
  refusal: 'content_filter'
};

function mapStopReason(reason) {
  return STOP_REASON_MAP[reason] || 'stop';
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      return '';
    })
    .join('');
}

function parseToolArguments(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args !== 'string' || !args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Converts an OpenAI image content part into an Anthropic image block. Base64
 * data URIs map to a `base64` source, plain URLs map to a `url` source.
 */
function convertImagePart(part) {
  const raw = part?.image_url;
  const url = typeof raw === 'string' ? raw : (raw?.url || part?.url);
  if (!url || typeof url !== 'string') return null;
  const dataMatch = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (dataMatch) {
    if (!dataMatch[2]) return null;
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataMatch[1] || 'image/jpeg',
        data: dataMatch[3]
      }
    };
  }
  return { type: 'image', source: { type: 'url', url } };
}

function convertUserBlocks(message) {
  const blocks = [];
  if (typeof message.content === 'string') {
    if (message.content) blocks.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === 'string') {
        if (part) blocks.push({ type: 'text', text: part });
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' || part.type === 'input_text') {
        if (part.text) blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url' || part.type === 'image') {
        const image = convertImagePart(part);
        if (image) blocks.push(image);
      }
    }
  } else if (message.content !== undefined && message.content !== null) {
    blocks.push({ type: 'text', text: String(message.content) });
  }
  if (message.cache_control && blocks.length) {
    blocks[blocks.length - 1].cache_control = message.cache_control;
  }
  return blocks;
}

function convertAssistantBlocks(message) {
  const blocks = [];
  if (typeof message.content === 'string') {
    if (message.content) blocks.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === 'string') {
        if (part) blocks.push({ type: 'text', text: part });
      } else if (part?.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
    }
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const fn = call?.function;
      if (!fn?.name) continue;
      blocks.push({
        type: 'tool_use',
        id: call.id || `toolu_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        name: fn.name,
        input: parseToolArguments(fn.arguments)
      });
    }
  }
  if (message.cache_control && blocks.length) {
    blocks[blocks.length - 1].cache_control = message.cache_control;
  }
  return blocks;
}

/**
 * Appends content blocks to the previous message when the role matches.
 * Anthropic expects alternating user/assistant turns, so consecutive OpenAI
 * turns of the same role (e.g. tool results followed by a user prompt) are
 * merged into one message.
 */
function mergeMessage(messages, role, blocks) {
  if (!blocks.length) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    last.content = [...last.content, ...blocks];
    return;
  }
  messages.push({ role, content: blocks });
}

function convertMessages(messages = []) {
  const systemParts = [];
  let systemCacheControl = null;
  const converted = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;

    if (message.role === 'system' || message.role === 'developer') {
      const text = textFromContent(message.content);
      if (text) systemParts.push(text);
      if (message.cache_control) systemCacheControl = message.cache_control;
      continue;
    }

    if (message.role === 'tool' || message.role === 'function') {
      if (message.tool_call_id) {
        const block = {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: textFromContent(message.content)
        };
        if (message.cache_control) block.cache_control = message.cache_control;
        mergeMessage(converted, 'user', [block]);
      } else {
        const text = textFromContent(message.content);
        if (text) mergeMessage(converted, 'user', [{ type: 'text', text }]);
      }
      continue;
    }

    if (message.role === 'assistant') {
      mergeMessage(converted, 'assistant', convertAssistantBlocks(message));
      continue;
    }

    mergeMessage(converted, 'user', convertUserBlocks(message));
  }

  const simplified = converted.map((message) => {
    if (message.content.length === 1
      && message.content[0].type === 'text'
      && !message.content[0].cache_control) {
      return { role: message.role, content: message.content[0].text };
    }
    return message;
  });

  const systemText = systemParts.join('\n\n');
  const system = systemText && systemCacheControl
    ? [{ type: 'text', text: systemText, cache_control: systemCacheControl }]
    : systemText;

  return { system, messages: simplified };
}

/**
 * Converts OpenAI function tools into Anthropic tools. OpenAI wraps the schema
 * in `function.parameters`; Anthropic expects it as a top-level `input_schema`.
 */
function convertTools(tools) {
  if (!Array.isArray(tools)) return [];
  const converted = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const fn = tool.function && typeof tool.function === 'object' ? tool.function : tool;
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) continue;
    const inputSchema = fn.parameters && typeof fn.parameters === 'object'
      ? fn.parameters
      : { type: 'object', properties: {} };
    const entry = { name: fn.name, input_schema: inputSchema };
    if (fn.description) entry.description = String(fn.description);
    if (tool.cache_control) entry.cache_control = tool.cache_control;
    converted.push(entry);
  }
  return converted;
}

/**
 * Maps OpenAI tool_choice values onto Anthropic's `auto` / `any` / `tool`
 * choices. `none` is handled by dropping the tool list entirely.
 */
function convertToolChoice(toolChoice, hasTools) {
  if (!hasTools) return undefined;
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'required') return { type: 'any' };
    return undefined;
  }
  if (toolChoice && typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    if (toolChoice.type === 'tool' && toolChoice.name) return { type: 'tool', name: toolChoice.name };
    if (toolChoice.type === 'any') return { type: 'any' };
    if (toolChoice.type === 'auto') return { type: 'auto' };
  }
  return undefined;
}

function jsonOutputSchema(responseFormat) {
  if (responseFormat?.type === 'json_schema') {
    const schema = responseFormat.json_schema?.schema;
    if (schema && typeof schema === 'object') return schema;
  }
  return { type: 'object', additionalProperties: true };
}

function normalizeUsage(usage = {}) {
  const input = Number(usage.input_tokens) || 0;
  const cached = Number(usage.cache_read_input_tokens) || 0;
  const cacheCreated = Number(usage.cache_creation_input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const promptTokens = input + cached + cacheCreated;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: promptTokens + output,
    prompt_tokens_details: { cached_tokens: cached }
  };
}

function generateCompletionId(providerId) {
  const rawId = String(providerId || '');
  return rawId
    ? rawId.replace(/^msg_/, 'chatcmpl-')
    : `chatcmpl-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

/**
 * Anthropic Messages API format (/v1/messages). Requests are converted from
 * OpenAI chat completions and responses/streams are converted back so clients
 * always see OpenAI-shaped data.
 */
export class AnthropicAdapter extends BaseAdapter {
  get format() {
    return 'anthropic';
  }

  get endpointHint() {
    return '/v1/messages';
  }

  getEndpointPath() {
    return '/v1/messages';
  }

  buildHeaders(apiKey) {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION
    };
    if (apiKey) headers['x-api-key'] = apiKey;
    return headers;
  }

  buildRequestBody(openaiBody, modelConfig = {}) {
    const { system, messages } = convertMessages(openaiBody.messages);
    const configuredMax = Number(modelConfig.max_output_tokens);
    const requestedMax = Number(openaiBody.max_tokens);
    const body = {
      model: modelConfig.model_id || openaiBody.model,
      messages,
      max_tokens: Number.isFinite(requestedMax) && requestedMax > 0
        ? requestedMax
        : (Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_TOKENS),
      stream: Boolean(openaiBody.stream)
    };
    if (system) body.system = system;
    if (openaiBody.temperature !== undefined && openaiBody.temperature !== null) {
      const temperature = Number(openaiBody.temperature);
      if (Number.isFinite(temperature)) {
        body.temperature = Math.max(0, Math.min(1, temperature));
      }
    }
    if (openaiBody.top_p !== undefined && openaiBody.top_p !== null) {
      body.top_p = openaiBody.top_p;
    }
    if (openaiBody.stop !== undefined && openaiBody.stop !== null) {
      body.stop_sequences = Array.isArray(openaiBody.stop) ? openaiBody.stop : [openaiBody.stop];
    }

    const toolChoiceNone = openaiBody.tool_choice === 'none' || openaiBody.function_call === 'none';
    const legacyFunctions = !Array.isArray(openaiBody.tools) && Array.isArray(openaiBody.functions)
      ? openaiBody.functions.map((fn) => ({ type: 'function', function: fn }))
      : null;
    const rawToolChoice = openaiBody.tool_choice !== undefined
      ? openaiBody.tool_choice
      : (typeof openaiBody.function_call === 'string'
          ? openaiBody.function_call
          : (openaiBody.function_call?.name
              ? { type: 'function', function: { name: openaiBody.function_call.name } }
              : undefined));
    let tools = toolChoiceNone ? [] : convertTools(legacyFunctions || openaiBody.tools);
    let toolChoice = toolChoiceNone ? undefined : convertToolChoice(rawToolChoice, tools.length > 0);
    if (toolChoice && openaiBody.parallel_tool_calls === false) {
      toolChoice = { ...toolChoice, disable_parallel_tool_use: true };
    }

    const responseFormat = openaiBody.response_format;
    if (responseFormat && typeof responseFormat === 'object'
      && (responseFormat.type === 'json_object' || responseFormat.type === 'json_schema')) {
      tools = [...tools, {
        name: JSON_OUTPUT_TOOL,
        description: 'Return the final answer as a single JSON object.',
        input_schema: jsonOutputSchema(responseFormat)
      }];
      toolChoice = { type: 'tool', name: JSON_OUTPUT_TOOL };
    }

    if (tools.length) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const native = openaiBody._anthropic_native && typeof openaiBody._anthropic_native === 'object'
      ? openaiBody._anthropic_native
      : {};
    if (Array.isArray(native.system) && native.system.length > 0) {
      body.system = native.system;
    }
    const topK = openaiBody.top_k !== undefined ? openaiBody.top_k : native.top_k;
    const metadata = openaiBody.metadata !== undefined ? openaiBody.metadata : native.metadata;
    const thinking = openaiBody.thinking !== undefined ? openaiBody.thinking : native.thinking;
    if (topK !== undefined && topK !== null) body.top_k = topK;
    if (metadata && typeof metadata === 'object') body.metadata = metadata;
    if (thinking && typeof thinking === 'object') body.thinking = thinking;

    return body;
  }

  transformResponse(providerResponse = {}, modelConfig = {}, requestBody = {}) {
    const contentBlocks = Array.isArray(providerResponse.content) ? providerResponse.content : [];
    const text = Array.isArray(providerResponse.content)
      ? contentBlocks.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
      : textFromContent(providerResponse.content);
    const toolUses = contentBlocks.filter((part) => part?.type === 'tool_use');
    const id = generateCompletionId(providerResponse.id);

    const jsonToolUse = requestBody?.response_format
      ? toolUses.find((block) => block.name === JSON_OUTPUT_TOOL)
      : null;
    if (jsonToolUse) {
      return {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelConfig.model_id || providerResponse.model || 'anthropic',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(jsonToolUse.input ?? {}) },
            finish_reason: 'stop'
          }
        ],
        usage: normalizeUsage(providerResponse.usage)
      };
    }

    const toolCalls = toolUses
      .filter((block) => block.name !== JSON_OUTPUT_TOOL || !requestBody?.response_format)
      .map((block) => ({
        id: block.id || `call_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {})
        }
      }));

    const message = {
      role: 'assistant',
      content: toolCalls.length ? (text || null) : text
    };
    if (toolCalls.length) message.tool_calls = toolCalls;

    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelConfig.model_id || providerResponse.model || 'anthropic',
      choices: [
        {
          index: 0,
          message,
          finish_reason: mapStopReason(providerResponse.stop_reason)
        }
      ],
      usage: normalizeUsage(providerResponse.usage)
    };
  }

  createStreamTransform(modelConfig = {}, requestBody = {}) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const id = `chatcmpl-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = modelConfig.model_id || 'anthropic';
    const jsonOutputRequested = Boolean(requestBody?.response_format);

    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let finalSent = false;
    let doneSent = false;
    let nextToolIndex = 0;
    let jsonHackActive = false;
    let pendingText = '';
    const toolBlocks = new Map();

    const sse = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
    const chunk = (delta, finishReason = null, usage = null) => {
      const payload = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }]
      };
      if (usage) payload.usage = usage;
      return sse(payload);
    };
    const usagePayload = () => ({
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: cachedTokens }
    });
    const sendFinal = (controller, finishReason = 'stop') => {
      if (finalSent) return;
      finalSent = true;
      controller.enqueue(chunk({}, finishReason, usagePayload()));
    };
    const sendDone = (controller) => {
      if (doneSent) return;
      doneSent = true;
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    };
    const flushPendingText = (controller) => {
      if (!pendingText) return;
      controller.enqueue(chunk({ content: pendingText }));
      pendingText = '';
    };

    const handleEvent = (event, controller) => {
      switch (event?.type) {
        case 'message_start': {
          const usage = event.message?.usage || {};
          cachedTokens = Number(usage.cache_read_input_tokens) || 0;
          promptTokens = (Number(usage.input_tokens) || 0)
            + cachedTokens
            + (Number(usage.cache_creation_input_tokens) || 0);
          completionTokens = Number(usage.output_tokens) || 0;
          break;
        }
        case 'content_block_start': {
          const block = event.content_block || {};
          if (block.type === 'tool_use') {
            const toolIndex = nextToolIndex++;
            const isJsonTool = jsonOutputRequested && block.name === JSON_OUTPUT_TOOL;
            toolBlocks.set(event.index, { toolIndex, isJsonTool });
            if (isJsonTool) {
              jsonHackActive = true;
              pendingText = '';
            } else {
              flushPendingText(controller);
              controller.enqueue(chunk({
                tool_calls: [{
                  index: toolIndex,
                  id: block.id || `call_${toolIndex}`,
                  type: 'function',
                  function: { name: block.name || '', arguments: '' }
                }]
              }));
            }
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta || {};
          if (delta.type === 'text_delta' && delta.text) {
            if (jsonOutputRequested) pendingText += delta.text;
            else controller.enqueue(chunk({ content: delta.text }));
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const info = toolBlocks.get(event.index);
            if (info?.isJsonTool) {
              if (delta.partial_json) controller.enqueue(chunk({ content: delta.partial_json }));
            } else if (info) {
              controller.enqueue(chunk({
                tool_calls: [{ index: info.toolIndex, function: { arguments: delta.partial_json } }]
              }));
            }
          }
          break;
        }
        case 'message_delta': {
          if (Number.isFinite(Number(event.usage?.output_tokens))) {
            completionTokens = Number(event.usage.output_tokens);
          }
          if (!jsonHackActive) flushPendingText(controller);
          const finishReason = jsonHackActive ? 'stop' : mapStopReason(event.delta?.stop_reason);
          sendFinal(controller, finishReason);
          break;
        }
        case 'message_stop': {
          if (!jsonHackActive) flushPendingText(controller);
          sendFinal(controller);
          sendDone(controller);
          break;
        }
        case 'error': {
          if (!jsonHackActive) flushPendingText(controller);
          controller.enqueue(sse({ error: event.error || { message: 'Upstream stream error' } }));
          sendDone(controller);
          break;
        }
        default:
          break;
      }
    };

    return new TransformStream({
      start(controller) {
        controller.enqueue(chunk({ role: 'assistant', content: '' }));
      },
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const rawEvent = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const dataLine = rawEvent.split(/\r?\n/).find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            handleEvent(JSON.parse(payload), controller);
          } catch {
            /* ignore malformed keepalive chunks */
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const dataLine = buffer.split(/\r?\n/).find((line) => line.startsWith('data:'));
          const payload = dataLine ? dataLine.slice(5).trim() : '';
          if (payload && payload !== '[DONE]') {
            try {
              handleEvent(JSON.parse(payload), controller);
            } catch {
              /* ignore trailing incomplete chunk */
            }
          }
          buffer = '';
        }
        if (!jsonHackActive) flushPendingText(controller);
        sendFinal(controller);
        sendDone(controller);
      }
    });
  }

  formatErrorMessage(bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      const message = parsed?.error?.message || parsed?.message;
      if (message) {
        const type = parsed?.error?.type;
        return type ? `${type}: ${message}` : message;
      }
    } catch {
      /* not JSON */
    }
    return bodyText;
  }
}
