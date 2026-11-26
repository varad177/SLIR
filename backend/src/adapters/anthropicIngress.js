/**
 * Converts a native Anthropic Messages API request (POST /v1/messages) into
 * the OpenAI chat-completions shape used internally by the SLIR pipeline.
 */

function textFromBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    if (content == null) return '';
    return typeof content === 'object' ? JSON.stringify(content) : String(content);
  }
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part && typeof part === 'object') return JSON.stringify(part);
      return '';
    })
    .join('');
}

function systemToText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return textFromBlocks(system);
}

function imageToOpenAIUrl(block) {
  const source = block?.source || {};
  if (source.type === 'base64' && source.data) {
    const mediaType = source.media_type || 'image/jpeg';
    return `data:${mediaType};base64,${source.data}`;
  }
  if (source.type === 'url' && source.url) return source.url;
  return null;
}

function mapToolChoice(choice) {
  if (!choice) return undefined;
  if (typeof choice === 'string') return choice;
  if (choice.type === 'auto') return 'auto';
  if (choice.type === 'any') return 'required';
  if (choice.type === 'none') return 'none';
  if (choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

function convertAssistantMessage(message) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: textFromBlocks(message.content) }];
  const textParts = [];
  const toolCalls = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      textParts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id || `call_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: {
          name: block.name || 'tool',
          arguments: JSON.stringify(block.input ?? {})
        }
      });
    }
  }
  const converted = {
    role: 'assistant',
    content: textParts.join('') || (toolCalls.length ? null : '')
  };
  if (toolCalls.length) converted.tool_calls = toolCalls;
  return converted;
}

function convertUserMessage(message, messages) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: textFromBlocks(message.content) }];

  const toolResults = [];
  const parts = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      if (block) parts.push({ type: 'text', text: block });
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      const url = imageToOpenAIUrl(block);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    } else if (block.type === 'tool_result') {
      toolResults.push(block);
    }
  }

  // OpenAI represents tool results as dedicated `tool` messages that must
  // precede any trailing user text from the same Anthropic turn.
  for (const result of toolResults) {
    messages.push({
      role: 'tool',
      tool_call_id: result.tool_use_id,
      content: textFromBlocks(result.content)
    });
  }

  if (parts.length === 1 && parts[0].type === 'text') {
    messages.push({ role: 'user', content: parts[0].text });
  } else if (parts.length > 1) {
    messages.push({ role: 'user', content: parts });
  }
}

/**
 * @param {Object} body Anthropic Messages API request body.
 * @returns {Object} OpenAI chat-completions request body.
 * @throws {Error} When the request does not contain a usable messages array.
 */
export function anthropicToOpenAI(body = {}) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('"messages" must be a non-empty array');
  }

  const messages = [];
  const system = systemToText(body.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const message of body.messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'assistant') {
      messages.push(convertAssistantMessage(message));
    } else {
      convertUserMessage(message, messages);
    }
  }

  const openai = {
    model: typeof body.model === 'string' ? body.model : 'active-model',
    messages,
    stream: Boolean(body.stream)
  };

  if (body.max_tokens !== undefined && body.max_tokens !== null) openai.max_tokens = body.max_tokens;
  if (body.temperature !== undefined && body.temperature !== null) openai.temperature = body.temperature;
  if (body.top_p !== undefined && body.top_p !== null) openai.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) {
    openai.stop = body.stop_sequences;
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    openai.tools = body.tools
      .filter((tool) => tool && typeof tool === 'object' && typeof tool.name === 'string')
      .map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          ...(tool.description ? { description: String(tool.description) } : {}),
          parameters: tool.input_schema && typeof tool.input_schema === 'object'
            ? tool.input_schema
            : { type: 'object', properties: {} }
        }
      }));
    if (!openai.tools.length) delete openai.tools;
  }

  const toolChoice = mapToolChoice(body.tool_choice);
  if (toolChoice !== undefined) openai.tool_choice = toolChoice;

  // Anthropic-native parameters are only forwarded when the resolved upstream
  // is itself Anthropic; other adapters strip this internal envelope.
  const native = {};
  if (Array.isArray(body.system) && body.system.length > 0) native.system = body.system;
  if (body.top_k !== undefined && body.top_k !== null) native.top_k = body.top_k;
  if (body.metadata && typeof body.metadata === 'object') native.metadata = body.metadata;
  if (body.thinking && typeof body.thinking === 'object') native.thinking = body.thinking;
  if (Object.keys(native).length) openai._anthropic_native = native;

  return openai;
}

export function mapFinishReasonToStopReason(finishReason) {
  switch (finishReason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    case 'stop':
    case null:
    case undefined:
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

export function formatAnthropicError(status, payload = {}) {
  const message = payload?.error?.message
    || payload?.message
    || `Request failed with status ${status}`;
  let type = 'api_error';
  if (status === 400 || status === 422) type = 'invalid_request_error';
  else if (status === 401 || status === 403) type = 'authentication_error';
  else if (status === 404) type = 'not_found_error';
  else if (status === 413) type = 'request_too_large';
  else if (status === 429) type = 'rate_limit_error';
  else if (status >= 400 && status < 500) type = 'invalid_request_error';
  return { type: 'error', error: { type, message } };
}
