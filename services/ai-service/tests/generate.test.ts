import request from 'supertest';
import { createApp } from '../src/app';
import { LLMError } from '../src/errors';
import type { ChatTurn, Completion, LLMProvider, StreamEvent } from '../src/llm/provider';

class FakeLLM implements LLMProvider {
  calls: { messages: ChatTurn[]; opts?: { maxTokens?: number } }[] = [];
  error?: Error;
  async complete(messages: ChatTurn[], _signal?: AbortSignal, opts?: { maxTokens?: number }): Promise<Completion> {
    this.calls.push({ messages, opts });
    if (this.error) throw this.error;
    return { content: '{"ok":true}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'fake' };
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<StreamEvent> {
    throw new Error('not used');
  }
}

const headers = { 'x-internal-key': 'test-internal-secret-123456', 'x-user-id': '65f0c0ffee0123456789abcd' };

describe('POST /api/ai/generate (internal)', () => {
  it('rejects callers without the internal key', async () => {
    const app = createApp({ llm: new FakeLLM() });
    const res = await request(app).post('/api/ai/generate').send({ system: 's', prompt: 'p' });
    expect(res.status).toBe(401);
  });

  it('returns the completion and asks for the larger generation token budget', async () => {
    const llm = new FakeLLM();
    const res = await request(createApp({ llm })).post('/api/ai/generate').set(headers).send({ system: 'sys', prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ content: '{"ok":true}', model: 'fake' });
    expect(llm.calls[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(llm.calls[0].opts?.maxTokens).toBe(3000);
  });

  it('validates the body', async () => {
    const res = await request(createApp({ llm: new FakeLLM() })).post('/api/ai/generate').set(headers).send({ system: 'only system' });
    expect(res.status).toBe(400);
  });

  it('maps provider failures to their API status', async () => {
    const llm = new FakeLLM();
    llm.error = new LLMError(504, 'LLM_TIMEOUT', 'The AI provider took too long to respond.', true);
    const res = await request(createApp({ llm })).post('/api/ai/generate').set(headers).send({ system: 's', prompt: 'p' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
  });
});
