import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app';
import { LLMError } from '../src/errors';
import type { ChatTurn, Completion, LLMProvider, StreamEvent } from '../src/llm/provider';
import { ChatMessage } from '../src/models/chatMessage.model';
import { ChatSession } from '../src/models/chatSession.model';

class FakeLLM implements LLMProvider {
  calls: ChatTurn[][] = [];
  reply = 'Fake reply';
  error?: Error;
  private usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

  async complete(messages: ChatTurn[]): Promise<Completion> {
    this.calls.push(messages);
    if (this.error) throw this.error;
    return { content: this.reply, usage: this.usage, model: 'fake-model' };
  }
  async *stream(messages: ChatTurn[]): AsyncGenerator<StreamEvent> {
    this.calls.push(messages);
    if (this.error) throw this.error;
    yield { type: 'delta', text: 'Hel' };
    yield { type: 'delta', text: 'lo' };
    yield { type: 'done', usage: this.usage, model: 'fake-model' };
  }
}

const SECRET = 'test-internal-secret-123456';
const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const as = (userId: string) => ({ 'x-internal-key': SECRET, 'x-user-id': userId });

let mongo: MongoMemoryServer;
let llm: FakeLLM;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => {
  llm = new FakeLLM();
  app = createApp({ llm });
});
afterEach(async () => {
  await ChatSession.deleteMany({});
  await ChatMessage.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const newSession = async (userId = userA, title?: string) =>
  (await request(app).post('/api/chat/sessions').set(as(userId)).send(title ? { title } : {})).body.session;
const send = (id: string, content: string, userId = userA) =>
  request(app).post(`/api/chat/sessions/${id}/messages`).set(as(userId)).send({ content });

describe('service authentication', () => {
  it('rejects requests without the internal key', async () => {
    const res = await request(app).get('/api/chat/sessions').set({ 'x-user-id': userA });
    expect(res.status).toBe(401);
  });
  it('rejects a wrong internal key', async () => {
    const res = await request(app).get('/api/chat/sessions').set({ 'x-internal-key': 'nope', 'x-user-id': userA });
    expect(res.status).toBe(401);
  });
  it('rejects a missing or malformed user id', async () => {
    const res = await request(app).get('/api/chat/sessions').set({ 'x-internal-key': SECRET, 'x-user-id': 'abc' });
    expect(res.status).toBe(401);
  });
});

describe('session management', () => {
  it('creates a session with a default title, or a custom one', async () => {
    const a = await request(app).post('/api/chat/sessions').set(as(userA)).send({});
    expect(a.status).toBe(201);
    expect(a.body.session.title).toBe('New chat');
    const b = await newSession(userA, 'Salary negotiation');
    expect(b.title).toBe('Salary negotiation');
  });

  it('lists only my sessions, with pagination and search', async () => {
    await newSession(userA, 'Resume tips');
    await newSession(userA, 'Interview prep');
    await newSession(userA, 'Resume review');
    await newSession(userB, 'Resume secret');

    const all = await request(app).get('/api/chat/sessions?limit=2&page=1').set(as(userA));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
    expect(all.body.items).toHaveLength(2);

    const found = await request(app).get('/api/chat/sessions?search=resume').set(as(userA));
    expect(found.body.total).toBe(2);
    expect(found.body.items.every((s: any) => /resume/i.test(s.title))).toBe(true);
  });

  it('treats regex characters in search as plain text', async () => {
    await newSession(userA, 'C++ roles');
    const res = await request(app).get('/api/chat/sessions?search=C%2B%2B').set(as(userA));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('renames a session and validates the title', async () => {
    const s = await newSession();
    const ok = await request(app).patch(`/api/chat/sessions/${s.id}`).set(as(userA)).send({ title: 'Renamed' });
    expect(ok.status).toBe(200);
    expect(ok.body.session.title).toBe('Renamed');
    const bad = await request(app).patch(`/api/chat/sessions/${s.id}`).set(as(userA)).send({ title: '   ' });
    expect(bad.status).toBe(400);
  });

  it('deletes a session together with its messages', async () => {
    const s = await newSession();
    await send(s.id, 'Hello');
    expect(await ChatMessage.countDocuments({ sessionId: s.id })).toBe(2);

    const del = await request(app).delete(`/api/chat/sessions/${s.id}`).set(as(userA));
    expect(del.status).toBe(204);
    expect(await ChatMessage.countDocuments({ sessionId: s.id })).toBe(0);
    expect((await request(app).get(`/api/chat/sessions/${s.id}`).set(as(userA))).status).toBe(404);
  });

  it("hides other users' sessions behind 404 for every operation", async () => {
    const s = await newSession(userA);
    const get = await request(app).get(`/api/chat/sessions/${s.id}`).set(as(userB));
    const patch = await request(app).patch(`/api/chat/sessions/${s.id}`).set(as(userB)).send({ title: 'x' });
    const del = await request(app).delete(`/api/chat/sessions/${s.id}`).set(as(userB));
    const msg = await send(s.id, 'hi', userB);
    expect([get.status, patch.status, del.status, msg.status]).toEqual([404, 404, 404, 404]);
    expect(await ChatSession.countDocuments({ _id: s.id })).toBe(1);
  });

  it('returns 404 for a malformed session id', async () => {
    const res = await request(app).get('/api/chat/sessions/not-an-id').set(as(userA));
    expect(res.status).toBe(404);
  });
});

describe('sending messages', () => {
  it('persists both messages, tracks usage and auto-titles the session', async () => {
    const s = await newSession();
    const res = await send(s.id, 'How do I switch to backend development?');
    expect(res.status).toBe(201);
    expect(res.body.userMessage).toMatchObject({ role: 'user', content: 'How do I switch to backend development?' });
    expect(res.body.assistantMessage).toMatchObject({ role: 'assistant', content: 'Fake reply', model: 'fake-model' });
    expect(res.body.session).toMatchObject({ title: 'How do I switch to backend development?', messageCount: 2, totalTokens: 15 });

    const opened = await request(app).get(`/api/chat/sessions/${s.id}`).set(as(userA));
    expect(opened.body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
  });

  it('sends earlier turns to the LLM so the conversation can continue', async () => {
    const s = await newSession();
    await send(s.id, 'First question');
    await send(s.id, 'Second question');
    expect(llm.calls[1].map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(llm.calls[1][3].content).toBe('Second question');
  });

  it('does not persist anything when the LLM fails, and returns the mapped status', async () => {
    const s = await newSession();
    llm.error = new LLMError(504, 'LLM_TIMEOUT', 'The AI provider took too long to respond.', true);
    const res = await send(s.id, 'Will this work?');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
    expect(await ChatMessage.countDocuments({ sessionId: s.id })).toBe(0);
    const session = await ChatSession.findById(s.id);
    expect(session!.messageCount).toBe(0);
  });

  it('never leaks unexpected internal errors', async () => {
    const s = await newSession();
    llm.error = new Error('secret stack detail sk-123');
    const res = await send(s.id, 'hi');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('sk-123');
  });

  it('validates message content', async () => {
    const s = await newSession();
    expect((await send(s.id, '   ')).status).toBe(400);
    expect((await send(s.id, 'x'.repeat(4001))).status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });

  it('applies a per-user AI rate limit', async () => {
    const limited = createApp({ llm, aiRateLimitPerMin: 2 });
    const s = (await request(limited).post('/api/chat/sessions').set(as(userA)).send({})).body.session;
    const post = () => request(limited).post(`/api/chat/sessions/${s.id}/messages`).set(as(userA)).send({ content: 'hi' });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    // another user has their own budget
    const other = (await request(limited).post('/api/chat/sessions').set(as(userB)).send({})).body.session;
    const otherRes = await request(limited).post(`/api/chat/sessions/${other.id}/messages`).set(as(userB)).send({ content: 'hi' });
    expect(otherRes.status).toBe(201);
  });
});

describe('streaming', () => {
  const sse = (id: string, content: string) =>
    request(app)
      .post(`/api/chat/sessions/${id}/messages/stream`)
      .set(as(userA))
      .send({ content })
      .buffer(true)
      .parse((r: any, cb: any) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });

  it('streams deltas, then a done event, and persists the exchange', async () => {
    const s = await newSession();
    const res = await sse(s.id, 'Stream please');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const body = res.body as unknown as string;
    expect(body).toContain('event: delta');
    expect(body).toContain('event: done');
    const saved = await ChatMessage.find({ sessionId: s.id }).sort({ _id: 1 });
    expect(saved.map((m) => m.content)).toEqual(['Stream please', 'Hello']);
  });

  it('returns a real HTTP error if the LLM fails before the first token', async () => {
    const s = await newSession();
    llm.error = new LLMError(504, 'LLM_TIMEOUT', 'The AI provider took too long to respond.', true);
    const res = await request(app).post(`/api/chat/sessions/${s.id}/messages/stream`).set(as(userA)).send({ content: 'hi' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
  });
});
