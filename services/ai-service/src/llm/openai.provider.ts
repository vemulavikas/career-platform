import { LLMError } from '../errors';
import { logger } from '../logger';
import type { ChatTurn, Completion, LLMProvider, StreamEvent, Usage } from './provider';

export interface OpenAIOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  retryBaseMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toUsage = (u: any): Usage => ({
  promptTokens: u?.prompt_tokens ?? 0,
  completionTokens: u?.completion_tokens ?? 0,
  totalTokens: u?.total_tokens ?? 0,
});

/** One HTTP attempt: its own AbortController, a timeout timer, and the caller's cancel signal wired in. */
class Attempt {
  private readonly controller = new AbortController();
  private timer?: NodeJS.Timeout;
  timedOut = false;

  constructor(private readonly timeoutMs: number, callerSignal?: AbortSignal) {
    callerSignal?.addEventListener('abort', () => this.controller.abort(), { once: true });
  }
  get signal() {
    return this.controller.signal;
  }
  arm() {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort();
    }, this.timeoutMs);
  }
  disarm() {
    if (this.timer) clearTimeout(this.timer);
  }
}

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly o: OpenAIOptions) {}

  private url() {
    return `${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  private init(messages: ChatTurn[], stream: boolean, signal: AbortSignal, maxTokens?: number): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({
        model: this.o.model,
        messages,
        max_tokens: maxTokens ?? this.o.maxOutputTokens,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      signal,
    };
  }

  private async httpError(res: Response): Promise<LLMError> {
    await res.text().catch(() => ''); // drain the body so the connection can be reused
    logger.warn({ status: res.status }, 'LLM provider returned an error status');
    if (res.status === 429) {
      return new LLMError(503, 'LLM_RATE_LIMITED', 'The AI provider is busy. Please try again shortly.', true);
    }
    if (res.status >= 500) {
      return new LLMError(502, 'LLM_UNAVAILABLE', 'The AI provider is temporarily unavailable.', true);
    }
    if (res.status === 401 || res.status === 403) {
      // Our credentials are wrong: a config problem, retrying will not help. Details stay in the logs.
      return new LLMError(502, 'LLM_AUTH_FAILED', 'The AI service is not configured correctly.', false);
    }
    return new LLMError(502, 'LLM_REQUEST_REJECTED', 'The AI provider rejected the request.', false);
  }

  private toLLMError(err: unknown, a: Attempt, callerSignal?: AbortSignal): LLMError {
    if (err instanceof LLMError) return err;
    if (callerSignal?.aborted) return new LLMError(499, 'CLIENT_CLOSED', 'Request cancelled', false);
    if (a.timedOut) return new LLMError(504, 'LLM_TIMEOUT', 'The AI provider took too long to respond.', true);
    logger.warn({ err }, 'LLM network error');
    return new LLMError(502, 'LLM_UNAVAILABLE', 'The AI provider is temporarily unavailable.', true);
  }

  /** Retries retryable failures (timeout, 429, 5xx, network) with exponential backoff + jitter. */
  private async withRetries<T>(callerSignal: AbortSignal | undefined, fn: (a: Attempt) => Promise<T>): Promise<T> {
    const base = this.o.retryBaseMs ?? 250;
    for (let i = 0; ; i++) {
      if (callerSignal?.aborted) throw new LLMError(499, 'CLIENT_CLOSED', 'Request cancelled', false);
      const attempt = new Attempt(this.o.timeoutMs, callerSignal);
      try {
        return await fn(attempt);
      } catch (err) {
        attempt.disarm();
        const e = this.toLLMError(err, attempt, callerSignal);
        if (!e.retryable || i >= this.o.maxRetries) throw e;
        await sleep(Math.min(base * 2 ** i, 4000) + Math.random() * base * 0.4);
      }
    }
  }

  async complete(messages: ChatTurn[], signal?: AbortSignal, opts?: { maxTokens?: number }): Promise<Completion> {
    return this.withRetries(signal, async (a) => {
      a.arm(); // timeout covers connecting AND reading the full body
      const res = await fetch(this.url(), this.init(messages, false, a.signal, opts?.maxTokens));
      if (!res.ok) throw await this.httpError(res);

      let json: any;
      try {
        json = await res.json();
      } catch (err) {
        if (a.signal.aborted) throw err; // a timeout, handled by toLLMError
        throw new LLMError(502, 'LLM_BAD_RESPONSE', 'The AI provider returned an unreadable response.', false);
      }
      a.disarm();

      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new LLMError(502, 'LLM_BAD_RESPONSE', 'The AI provider returned an empty or malformed response.', false);
      }
      return { content, usage: toUsage(json.usage), model: String(json.model ?? this.o.model) };
    });
  }

  /**
   * Streams tokens. Retries are only possible before the first byte arrives; once tokens are flowing
   * a failure is surfaced to the caller (we cannot un-send text). The timeout becomes an idle timeout.
   */
  async *stream(messages: ChatTurn[], signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const { res, a } = await this.withRetries(signal, async (attempt) => {
      attempt.arm();
      const response = await fetch(this.url(), this.init(messages, true, attempt.signal));
      if (!response.ok) throw await this.httpError(response);
      return { res: response, a: attempt };
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let usage = toUsage(undefined);
    let model = this.o.model;
    let received = false;

    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        a.arm(); // reset the idle timer on every chunk
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '' || data === '[DONE]') continue;

          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            throw new LLMError(502, 'LLM_BAD_RESPONSE', 'The AI provider returned a malformed stream.', false);
          }
          if (json.model) model = String(json.model);
          if (json.usage) usage = toUsage(json.usage);
          const text = json.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text.length > 0) {
            received = true;
            yield { type: 'delta', text };
          }
        }
      }
    } catch (err) {
      throw this.toLLMError(err, a, signal);
    } finally {
      a.disarm();
    }

    if (!received) throw new LLMError(502, 'LLM_BAD_RESPONSE', 'The AI provider returned an empty response.', false);
    yield { type: 'done', usage, model };
  }
}
