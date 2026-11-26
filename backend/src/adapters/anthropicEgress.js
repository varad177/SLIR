import { mapFinishReasonToStopReason } from './anthropicIngress.js';

/**
 * Converts an OpenAI-shaped chat completion (the SLIR internal response) back
 * into a native Anthropic Messages API response for /v1/messages clients.
 */

function toMessageId(id) {
  const raw = String(id || '');
  if (!raw) return `msg_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  if (raw.startsWith('msg_')) return raw;
  if (raw.startsWith('chatcmpl-')) return `msg_${raw.slice('chatcmpl-'.length)}`;
  return `msg_${raw}`;
}

function parseToolInput(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args !== 'string' || !args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function openAIToAnthropicResponse(data = {}, context = {}) {
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice?.message || {};
  const content = [];

  const text = typeof message.content === 'string' ? message.content : '';
  if (text) content.push({ type: 'text', text });

  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const fn = call?.function || {};
      content.push({
        type: 'tool_use',
        id: call.id || `toolu_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        name: fn.name || 'tool',
        input: parseToolInput(fn.arguments)
      });
    }
  }

  if (!content.length) content.push({ type: 'text', text: '' });

  const usage = data.usage || {};
  return {
    id: toMessageId(data.id),
    type: 'message',
    role: 'assistant',
    model: context.model || data.model || 'unknown',
    content,
    stop_reason: mapFinishReasonToStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens) || 0,
      output_tokens: Number(usage.completion_tokens) || 0
    }
  };
}

/**
 * Builds a web TransformStream that converts OpenAI chat-completion SSE
 * (`data: {...}`) into the Anthropic event sequence consumed by native SDKs:
 * message_start, content_block_start/delta/stop, message_delta, message_stop.
 */
export function createOpenAIToAnthropicStream(context = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const model = context.model || 'unknown';

  let buffer = '';
  let started = false;
  let finished = false;
  let messageId = null;
  let nextBlockIndex = 0;
  let textBlockOpen = false;
  let textBlockIndex = null;
  let pendingStopReason = null;
  let finalUsage = null;
  const toolBlocks = new Map();

  const event = (type, payload) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);

  const ensureStarted = (controller, chunk) => {
    if (started) return;
    started = true;
    messageId = toMessageId(chunk?.id);
    controller.enqueue(event('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    }));
  };

  const closeTextBlock = (controller) => {
    if (!textBlockOpen) return;
    textBlockOpen = false;
    controller.enqueue(event('content_block_stop', {
      type: 'content_block_stop',
      index: textBlockIndex
    }));
  };

  const closeAllBlocks = (controller) => {
    closeTextBlock(controller);
    for (const info of toolBlocks.values()) {
      if (!info.closed) {
        info.closed = true;
        controller.enqueue(event('content_block_stop', {
          type: 'content_block_stop',
          index: info.blockIndex
        }));
      }
    }
  };

  const finish = (controller) => {
    if (finished) return;
    finished = true;
    closeAllBlocks(controller);
    if (nextBlockIndex === 0) {
      controller.enqueue(event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }));
      controller.enqueue(event('content_block_stop', { type: 'content_block_stop', index: 0 }));
      nextBlockIndex = 1;
    }
    controller.enqueue(event('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: pendingStopReason || 'end_turn',
        stop_sequence: null
      },
      usage: { output_tokens: Number(finalUsage?.completion_tokens) || 0 }
    }));
    controller.enqueue(event('message_stop', { type: 'message_stop' }));
  };

  const handleChunk = (chunk, controller) => {
    if (!chunk || typeof chunk !== 'object') return;

    if (chunk.error) {
      ensureStarted(controller, chunk);
      finished = true;
      closeAllBlocks(controller);
      controller.enqueue(event('error', {
        type: 'error',
        error: {
          type: 'api_error',
          message: chunk.error.message || 'Upstream stream error'
        }
      }));
      return;
    }

    if (chunk.usage) finalUsage = chunk.usage;
    ensureStarted(controller, chunk);

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    const delta = choice?.delta || {};

    if (typeof delta.content === 'string' && delta.content.length) {
      if (!textBlockOpen) {
        textBlockOpen = true;
        textBlockIndex = nextBlockIndex++;
        controller.enqueue(event('content_block_start', {
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' }
        }));
      }
      controller.enqueue(event('content_block_delta', {
        type: 'content_block_delta',
        index: textBlockIndex,
        delta: { type: 'text_delta', text: delta.content }
      }));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const openaiIndex = Number.isFinite(call?.index) ? call.index : 0;
        let info = toolBlocks.get(openaiIndex);
        if (!info) {
          closeTextBlock(controller);
          info = {
            blockIndex: nextBlockIndex++,
            id: call?.id || `toolu_${openaiIndex}`,
            name: call?.function?.name || 'tool',
            closed: false
          };
          toolBlocks.set(openaiIndex, info);
          controller.enqueue(event('content_block_start', {
            type: 'content_block_start',
            index: info.blockIndex,
            content_block: {
              type: 'tool_use',
              id: info.id,
              name: info.name,
              input: {}
            }
          }));
        }
        const args = call?.function?.arguments;
        if (typeof args === 'string' && args.length) {
          controller.enqueue(event('content_block_delta', {
            type: 'content_block_delta',
            index: info.blockIndex,
            delta: { type: 'input_json_delta', partial_json: args }
          }));
        }
      }
    }

    if (choice?.finish_reason) {
      pendingStopReason = mapFinishReasonToStopReason(choice.finish_reason);
    }
  };

  return new TransformStream({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const rawEvent = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const dataLine = rawEvent.split(/\r?\n/).find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          if (!started) ensureStarted(controller, {});
          finish(controller);
          continue;
        }
        try {
          handleChunk(JSON.parse(payload), controller);
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
            handleChunk(JSON.parse(payload), controller);
          } catch {
            /* ignore trailing incomplete chunk */
          }
        }
        buffer = '';
      }
      if (!started) ensureStarted(controller, {});
      finish(controller);
    }
  });
}
