import OpenAI from 'openai';
import { getSetting } from './settings';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type StreamCallbacks = {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
};

const activeStreams = new Map<string, AbortController>();

export function stopStream(requestId: string): void {
  const controller = activeStreams.get(requestId);
  if (controller) {
    controller.abort();
    activeStreams.delete(requestId);
  }
}

function isAnthropicProvider(baseURL: string): boolean {
  return baseURL.includes('api.anthropic.com');
}

async function streamAnthropic(
  requestId: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  baseURL: string,
  apiKey: string,
  model: string,
): Promise<void> {
  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  // Separate system message from the rest
  const systemMsg = messages.find((m) => m.role === 'system');
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

  try {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      stream: true,
      messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      callbacks.onError(`Anthropic API error ${res.status}: ${text}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            callbacks.onChunk(event.delta.text);
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    callbacks.onDone();
  } catch (err: unknown) {
    if (controller.signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    callbacks.onError(message);
  } finally {
    activeStreams.delete(requestId);
  }
}

export async function streamChat(
  requestId: string,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<void> {
  const baseURL = getSetting('ai_base_url');
  const apiKey = getSetting('ai_api_key');
  const model = getSetting('ai_model');

  if (!baseURL || !model) {
    callbacks.onError('AI is not configured. Go to Settings → AI to set it up.');
    return;
  }

  // Anthropic uses a different API format
  if (isAnthropicProvider(baseURL)) {
    return streamAnthropic(requestId, messages, callbacks, baseURL, apiKey || '', model);
  }

  const client = new OpenAI({
    baseURL,
    apiKey: apiKey || 'not-needed', // Ollama and some local providers don't need a key
  });

  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
      },
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      if (controller.signal.aborted) break;
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        callbacks.onChunk(text);
      }
    }

    callbacks.onDone();
  } catch (err: unknown) {
    if (controller.signal.aborted) return; // intentional stop
    const message = err instanceof Error ? err.message : String(err);
    callbacks.onError(message);
  } finally {
    activeStreams.delete(requestId);
  }
}
