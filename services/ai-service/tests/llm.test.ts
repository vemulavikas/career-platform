import { buildContext, SYSTEM_PROMPT } from '../src/llm/context';
import { OpenAIProvider } from '../src/llm/openai.provider';
import type { StreamEvent } from '../src/llm/provider';

const provider = (over: Partial<ConstructorParameters<typeof OpenAIProvider>[0]> = {}) =>
  new OpenAIProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://llm.example/v1',
    model: 'test-model',
    timeoutMs: 1000,
    maxRetries: 2,
    maxOutputTokens: 100,
    retryBaseMs: 5,
    ...over,
  });

const okBody = {
  model: 'test-model',
  choices: [{ message: { role: 'assistant', content: 'Hi there' } }],
  usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const msgs = [{ role: 'user' as const, content: 'hello' }];

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

describe('OpenAIProvider.complete', () => {
  it('returns content and usage on success, sending the key only in the auth header', async () => {
    fetchMock.mockResolvedValueOnce(json(okBody));
    const out = await provider().complete(msgs);
    expect(out).toEqual({ content: 'Hi there', usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 }, model: 'test-model' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    expect(init.body).not.toContain('sk-test');
  });

  it('retries a 429 and then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(json(okBody));
    const out = await provider().complete(msgs);
    expect(out.content).toBe('Hi there');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and maps 429 to LLM_RATE_LIMITED', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 429 }));
    await expect(provider().complete(msgs)).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it('retries 5xx errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(json(okBody));
    await expect(provider().complete(msgs)).resolves.toMatchObject({ content: 'Hi there' });
  });

  it('does not retry auth failures and does not expose details', async () => {
    fetchMock.mockResolvedValue(new Response('invalid api key sk-test', { status: 401 }));
    const err: any = await provider().complete(msgs).catch((e) => e);
    expect(err.code).toBe('LLM_AUTH_FAILED');
    expect(err.message).not.toContain('sk-test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed response without retrying', async () => {
    fetchMock.mockResolvedValue(json({ choices: [] }));
    await expect(provider().complete(msgs)).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE', status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out a hung provider with LLM_TIMEOUT', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    await expect(provider({ timeoutMs: 50, maxRetries: 0 }).complete(msgs)).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
      status: 504,
    });
  });

  it('stops immediately when the caller cancels', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(provider().complete(msgs, ac.signal)).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAIProvider.stream', () => {
  const sseResponse = (lines: string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          lines.forEach((l) => controller.enqueue(enc.encode(l)));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  it('parses SSE chunks (even split across reads) into deltas plus a final usage event', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"model":"test-model","choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[],"usage":{"prompt_t',
        'okens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const events: StreamEvent[] = [];
    for await (const e of provider().stream(msgs)) events.push(e);
    expect(events).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 }, model: 'test-model' },
    ]);
  });

  it('retries a failed connection before the first token', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']));
    const events: StreamEvent[] = [];
    for await (const e of provider().stream(msgs)) events.push(e);
    expect(events[0]).toEqual({ type: 'delta', text: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails on a stream that produces no content', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']));
    const run = async () => {
      for await (const _e of provider().stream(msgs)) {
        /* drain */
      }
    };
    await expect(run()).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
  });
});

describe('buildContext', () => {
  const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

  it('starts with the system prompt and keeps order', () => {
    const out = buildContext([turn('user', 'a'), turn('assistant', 'b'), turn('user', 'c')], 1000);
    expect(out[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(out.slice(1).map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest turns first when over budget', () => {
    const out = buildContext([turn('user', 'x'.repeat(50)), turn('assistant', 'y'.repeat(50)), turn('user', 'z'.repeat(50))], 110);
    expect(out.slice(1).map((m) => m.content[0])).toEqual(['y', 'z']);
  });

  it('always keeps the newest message, even if it alone exceeds the budget', () => {
    const out = buildContext([turn('user', 'old'), turn('user', 'n'.repeat(500))], 100);
    expect(out).toHaveLength(2);
    expect(out[1].content[0]).toBe('n');
  });
});
