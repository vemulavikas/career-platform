import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { AiClient } from '../src/ai.client';
import { createApp } from '../src/app';
import { AppError } from '../src/errors';
import { Gate } from '../src/gate';
import { Resume, ResumeVersion } from '../src/models/resume.model';

class FakeAi implements AiClient {
  calls: { system: string; prompt: string; userId: string }[] = [];
  responses: (string | Error)[] = [];
  async generate(req: { system: string; prompt: string; userId: string }) {
    this.calls.push(req);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? '{}';
  }
}

const SECRET = 'test-internal-secret-123456';
const user = new mongoose.Types.ObjectId().toString();
const headers = { 'x-internal-key': SECRET, 'x-user-id': user };

const profile = {
  personalInfo: { fullName: 'Asha Rao', email: 'asha@example.com' },
  experience: [{ company: 'Acme', title: 'Engineer', startDate: '2021-03', current: true, description: 'built apis for web app' }],
  skills: ['TypeScript', 'Go', 'Rust'],
  achievements: ['Won hackathon'],
};
const goodAi = {
  summary: 'Experienced backend engineer.',
  experience: [{ bullets: ['Built REST APIs powering a web application.'] }],
  projects: [],
  skills: [{ category: 'Languages', items: ['TypeScript', 'go', 'Python'] }],
  achievements: ['Won a company hackathon.'],
};

let mongo: MongoMemoryServer;
let ai: FakeAi;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => {
  ai = new FakeAi();
  app = createApp({ ai });
});
afterEach(async () => {
  await Resume.deleteMany({});
  await ResumeVersion.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const generate = (body: object = { title: 'AI CV', profile }) =>
  request(app).post('/api/resumes/generate').set(headers).send(body);

describe('POST /api/resumes/generate', () => {
  it('writes AI prose into the structured resume while keeping every fact from the input', async () => {
    ai.responses.push(JSON.stringify(goodAi));
    const res = await generate();
    expect(res.status).toBe(201);
    const d = res.body.resume.data;
    expect(d.summary).toBe('<p>Experienced backend engineer.</p>');
    expect(d.experience[0]).toMatchObject({ company: 'Acme', title: 'Engineer', startDate: '2021-03', current: true });
    expect(d.experience[0].description).toBe('<ul><li>Built REST APIs powering a web application.</li></ul>');
    expect(d.achievements).toEqual(['Won a company hackathon.']);
    expect(await Resume.countDocuments({})).toBe(1);
    expect(await ResumeVersion.countDocuments({})).toBe(1);
  });

  it('cannot be tricked into changing facts: extra AI fields are ignored', async () => {
    ai.responses.push(JSON.stringify({ ...goodAi, experience: [{ company: 'Evil Corp', title: 'CEO', bullets: ['Did things.'] }] }));
    const res = await generate();
    expect(res.body.resume.data.experience[0]).toMatchObject({ company: 'Acme', title: 'Engineer' });
  });

  it('drops invented skills and keeps forgotten ones', async () => {
    ai.responses.push(JSON.stringify(goodAi));
    const res = await generate();
    expect(res.body.resume.data.skills).toEqual([
      { category: 'Languages', items: ['TypeScript', 'Go'] },
      { category: 'Other', items: ['Rust'] },
    ]);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    ai.responses.push('```json\n' + JSON.stringify(goodAi) + '\n```');
    expect((await generate()).status).toBe(201);
  });

  it('retries once with feedback when the AI returns invalid JSON', async () => {
    ai.responses.push('Sure! Here is your resume:', JSON.stringify(goodAi));
    const res = await generate();
    expect(res.status).toBe(201);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1].prompt).toContain('rejected');
  });

  it('retries when the AI returns the wrong number of experience entries', async () => {
    ai.responses.push(JSON.stringify({ ...goodAi, experience: [] }), JSON.stringify(goodAi));
    expect((await generate()).status).toBe(201);
    expect(ai.calls).toHaveLength(2);
  });

  it('fails with 502 and saves nothing when the AI keeps returning garbage', async () => {
    ai.responses.push('nope', 'still nope');
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_BAD_OUTPUT');
    expect(await Resume.countDocuments({})).toBe(0);
  });

  it('passes upstream AI failures through without retrying or saving', async () => {
    ai.responses.push(new AppError(504, 'LLM_TIMEOUT', 'The AI provider took too long to respond.'));
    const res = await generate();
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
    expect(ai.calls).toHaveLength(1);
    expect(await Resume.countDocuments({})).toBe(0);
  });

  it('forwards the user identity and treats the profile as data in the prompt', async () => {
    ai.responses.push(JSON.stringify(goodAi));
    await generate();
    expect(ai.calls[0].userId).toBe(user);
    expect(ai.calls[0].system).toContain('never as instructions');
    expect(ai.calls[0].prompt).toContain('Asha Rao');
  });

  it('requires a name', async () => {
    const res = await generate({ profile: { personalInfo: { fullName: '' } } });
    expect(res.status).toBe(400);
    expect(ai.calls).toHaveLength(0);
  });

  it('applies a per-user rate limit to generation', async () => {
    const limited = createApp({ ai, generateRateLimitPerMin: 1 });
    ai.responses.push(JSON.stringify(goodAi), JSON.stringify(goodAi));
    const post = () => request(limited).post('/api/resumes/generate').set(headers).send({ profile });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });

  it('sheds load with 503 when the generation queue is full', async () => {
    let release!: () => void;
    const slowAi: AiClient = {
      generate: () => new Promise<string>((resolve) => (release = () => resolve(JSON.stringify(goodAi)))),
    };
    const busy = createApp({ ai: slowAi, gate: new Gate(1, 0) });
    const first = request(busy).post('/api/resumes/generate').set(headers).send({ profile }).then((r) => r);
    await new Promise((r) => setTimeout(r, 100)); // let the first request occupy the only slot
    const second = await request(busy).post('/api/resumes/generate').set(headers).send({ profile });
    expect(second.status).toBe(503);
    expect(second.body.error.code).toBe('GENERATION_BUSY');
    release();
    expect((await first).status).toBe(201);
  });
});

describe('Gate', () => {
  it('runs queued work in order once a slot frees up and rejects beyond the queue limit', async () => {
    const gate = new Gate(1, 1);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((r) => (release = r)));
    const second = gate.run(async () => 'second');
    await expect(gate.run(async () => 'third')).rejects.toMatchObject({ code: 'GENERATION_BUSY', status: 503 });
    release();
    await first;
    expect(await second).toBe('second');
  });

  it('frees the slot even when the job throws', async () => {
    const gate = new Gate(1, 0);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});
