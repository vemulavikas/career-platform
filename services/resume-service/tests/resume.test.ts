import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { AiClient } from '../src/ai.client';
import { createApp } from '../src/app';
import { Resume, ResumeVersion } from '../src/models/resume.model';

const noAi: AiClient = { generate: async () => { throw new Error('AI should not be called'); } };
const app = createApp({ ai: noAi });

const SECRET = 'test-internal-secret-123456';
const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();
const as = (id: string) => ({ 'x-internal-key': SECRET, 'x-user-id': id });

const sampleData = {
  personalInfo: { fullName: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210', location: 'Hyderabad' },
  summary: '<p>Backend engineer.</p>',
  experience: [
    { company: 'Acme', title: 'Engineer', startDate: '2021-03', current: true, description: '<ul><li>Built APIs</li></ul>' },
  ],
  skills: [{ category: 'Languages', items: ['TypeScript', 'Go'] }],
};

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Resume.init();
  await ResumeVersion.init();
});
afterEach(async () => {
  await Resume.deleteMany({});
  await ResumeVersion.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const create = async (userId = userA, title = 'My resume', data: object = sampleData) =>
  (await request(app).post('/api/resumes').set(as(userId)).send({ title, data })).body.resume;
const patch = (id: string, body: object, userId = userA) =>
  request(app).patch(`/api/resumes/${id}`).set(as(userId)).send(body);

describe('authentication', () => {
  it('rejects requests without service credentials', async () => {
    expect((await request(app).get('/api/resumes')).status).toBe(401);
    expect((await request(app).get('/api/resumes').set({ 'x-user-id': userA })).status).toBe(401);
  });
});

describe('create and read', () => {
  it('creates a resume with defaults filled in and version 1', async () => {
    const res = await request(app).post('/api/resumes').set(as(userA)).send({ title: 'Backend CV', data: sampleData });
    expect(res.status).toBe(201);
    expect(res.body.resume).toMatchObject({ title: 'Backend CV', templateId: 'modern', version: 1 });
    expect(res.body.resume.data.personalInfo.fullName).toBe('Asha Rao');
    expect(res.body.resume.data.education).toEqual([]);
    expect(res.body.resume.data.achievements).toEqual([]);
  });

  it('creates an empty resume skeleton when no data is given', async () => {
    const res = await request(app).post('/api/resumes').set(as(userA)).send({ title: 'Blank' });
    expect(res.status).toBe(201);
    expect(res.body.resume.data.summary).toBe('');
  });

  it('strips dangerous HTML from rich-text fields', async () => {
    const res = await request(app)
      .post('/api/resumes')
      .set(as(userA))
      .send({
        title: 'XSS',
        data: { summary: '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)>' },
      });
    expect(res.status).toBe(201);
    const s: string = res.body.resume.data.summary;
    expect(s).not.toMatch(/<script|onclick|onerror|javascript:|<img/i);
    expect(s).toContain('Hi');
  });

  it('rejects javascript: links in structured URL fields', async () => {
    const res = await request(app)
      .post('/api/resumes')
      .set(as(userA))
      .send({ title: 'x', data: { personalInfo: { linkedin: 'javascript:alert(1)' } } });
    expect(res.status).toBe(400);
  });

  it('rejects invalid input', async () => {
    expect((await request(app).post('/api/resumes').set(as(userA)).send({ title: '' })).status).toBe(400);
    expect((await request(app).post('/api/resumes').set(as(userA)).send({ title: 'x', templateId: 'fancy' })).status).toBe(400);
    expect((await request(app).post('/api/resumes').set(as(userA)).send({ title: 'x', data: { hacker: 1 } })).status).toBe(400);
    expect(
      (await request(app).post('/api/resumes').set(as(userA)).send({ title: 'x', data: { experience: [{ startDate: '03/2021' }] } })).status,
    ).toBe(400);
  });

  it("returns my resume, and 404 for someone else's or a malformed id", async () => {
    const r = await create(userA);
    expect((await request(app).get(`/api/resumes/${r.id}`).set(as(userA))).status).toBe(200);
    expect((await request(app).get(`/api/resumes/${r.id}`).set(as(userB))).status).toBe(404);
    expect((await request(app).get('/api/resumes/not-an-id').set(as(userA))).status).toBe(404);
  });
});

describe('listing', () => {
  it('paginates, searches, filters and sorts server-side, and only returns my resumes', async () => {
    await create(userA, 'Backend CV');
    await create(userA, 'Frontend CV');
    await create(userA, 'Data Science');
    await create(userB, 'Backend secret');
    const first = (await create(userA, 'Zebra')).id;
    await patch(first, { templateId: 'ats-classic' });

    const page1 = await request(app).get('/api/resumes?limit=2&page=1').set(as(userA));
    expect(page1.body).toMatchObject({ total: 4, page: 1, limit: 2, totalPages: 2 });
    expect(page1.body.items).toHaveLength(2);

    const search = await request(app).get('/api/resumes?search=cv').set(as(userA));
    expect(search.body.total).toBe(2);

    const filtered = await request(app).get('/api/resumes?templateId=ats-classic').set(as(userA));
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].title).toBe('Zebra');

    const sorted = await request(app).get('/api/resumes?sort=title').set(as(userA));
    expect(sorted.body.items.map((i: any) => i.title)).toEqual(['Backend CV', 'Data Science', 'Frontend CV', 'Zebra']);

    expect((await request(app).get('/api/resumes?sort=password').set(as(userA))).status).toBe(400);
  });

  it('returns light list items without the full content', async () => {
    await create();
    const res = await request(app).get('/api/resumes').set(as(userA));
    const item = res.body.items[0];
    expect(item.data.personalInfo.fullName).toBe('Asha Rao');
    expect(item.data.experience ?? []).toHaveLength(0); // the stored experience entry is not sent in list responses
  });
});

describe('updating, concurrency and versions', () => {
  it('updates content, bumps the version and records a snapshot', async () => {
    const r = await create();
    const res = await patch(r.id, { data: { ...sampleData, summary: '<p>New summary</p>' } });
    expect(res.status).toBe(200);
    expect(res.body.resume.version).toBe(2);
    expect(res.body.resume.data.summary).toBe('<p>New summary</p>');
    expect(await ResumeVersion.countDocuments({ resumeId: r.id })).toBe(2);
  });

  it('rejects an empty update and unknown fields', async () => {
    const r = await create();
    expect((await patch(r.id, {})).status).toBe(400);
    expect((await patch(r.id, { userId: userB })).status).toBe(400);
  });

  it('detects conflicting edits with baseVersion (optimistic concurrency)', async () => {
    const r = await create();
    expect((await patch(r.id, { title: 'Tab 1', baseVersion: 1 })).status).toBe(200);
    const stale = await patch(r.id, { title: 'Tab 2', baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await Resume.findById(r.id))!.title).toBe('Tab 1');
  });

  it('lets only one of two simultaneous updates with the same baseVersion win', async () => {
    const r = await create();
    const results = await Promise.all([patch(r.id, { title: 'A', baseVersion: 1 }), patch(r.id, { title: 'B', baseVersion: 1 })]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  });

  it("cannot update someone else's resume", async () => {
    const r = await create(userA);
    expect((await patch(r.id, { title: 'hacked' }, userB)).status).toBe(404);
    expect((await Resume.findById(r.id))!.title).toBe('My resume');
  });

  it('lists versions, reads an old one and restores it as a new version', async () => {
    const r = await create();
    await patch(r.id, { data: { ...sampleData, summary: '<p>Edited</p>' } });

    const list = await request(app).get(`/api/resumes/${r.id}/versions`).set(as(userA));
    expect(list.body.items.map((v: any) => v.version)).toEqual([2, 1]);
    expect(list.body.items[0].data).toBeUndefined();

    const v1 = await request(app).get(`/api/resumes/${r.id}/versions/1`).set(as(userA));
    expect(v1.body.version.data.summary).toBe('<p>Backend engineer.</p>');

    const restored = await request(app).post(`/api/resumes/${r.id}/versions/1/restore`).set(as(userA));
    expect(restored.status).toBe(200);
    expect(restored.body.resume.version).toBe(3);
    expect(restored.body.resume.data.summary).toBe('<p>Backend engineer.</p>');
    expect(await ResumeVersion.countDocuments({ resumeId: r.id })).toBe(3);
  });

  it('keeps only the newest versions (retention window)', async () => {
    const r = await create();
    for (let i = 0; i < 5; i++) await patch(r.id, { title: `Title ${i}` });
    const versions = await ResumeVersion.find({ resumeId: r.id }).sort({ version: 1 });
    expect(versions.map((v) => v.version)).toEqual([4, 5, 6]); // MAX_VERSIONS_PER_RESUME=3 in tests
    expect((await request(app).get(`/api/resumes/${r.id}/versions/1`).set(as(userA))).status).toBe(404);
  });
});

describe('duplicate and delete', () => {
  it('duplicates a resume without touching the original', async () => {
    const r = await create();
    const res = await request(app).post(`/api/resumes/${r.id}/duplicate`).set(as(userA));
    expect(res.status).toBe(201);
    expect(res.body.resume.id).not.toBe(r.id);
    expect(res.body.resume.title).toBe('My resume (copy)');
    expect(res.body.resume.version).toBe(1);
    expect(res.body.resume.data.personalInfo.fullName).toBe('Asha Rao');
    expect(await Resume.countDocuments({})).toBe(2);
  });

  it('deletes a resume and its version history', async () => {
    const r = await create();
    await patch(r.id, { title: 'Changed' });
    expect((await request(app).delete(`/api/resumes/${r.id}`).set(as(userA))).status).toBe(204);
    expect(await ResumeVersion.countDocuments({ resumeId: r.id })).toBe(0);
    expect((await request(app).delete(`/api/resumes/${r.id}`).set(as(userA))).status).toBe(404);
  });

  it("cannot delete someone else's resume", async () => {
    const r = await create(userA);
    expect((await request(app).delete(`/api/resumes/${r.id}`).set(as(userB))).status).toBe(404);
    expect(await Resume.countDocuments({ _id: r.id })).toBe(1);
  });
});

describe('templates, preview and export', () => {
  it('lists both templates', async () => {
    const res = await request(app).get('/api/resumes/templates').set(as(userA));
    expect(res.body.templates.map((t: any) => t.id)).toEqual(['modern', 'ats-classic']);
  });

  it('renders the saved resume as HTML with a locked-down CSP', async () => {
    const r = await create();
    const res = await request(app).get(`/api/resumes/${r.id}/preview`).set(as(userA));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.text).toContain('<h1>Asha Rao</h1>');
    expect(res.text).toContain('tpl-modern');
  });

  it('previews another template with the same data, without saving the change', async () => {
    const r = await create();
    const res = await request(app).get(`/api/resumes/${r.id}/preview?template=ats-classic`).set(as(userA));
    expect(res.text).toContain('tpl-ats-classic');
    expect(res.text).toContain('Asha Rao');
    expect((await Resume.findById(r.id))!.templateId).toBe('modern');
    expect((await request(app).get(`/api/resumes/${r.id}/preview?template=nope`).set(as(userA))).status).toBe(400);
  });

  it('exports as a downloadable HTML file', async () => {
    const r = await create(userA, 'Backend CV 2026');
    const res = await request(app).get(`/api/resumes/${r.id}/export`).set(as(userA));
    expect(res.headers['content-disposition']).toBe('attachment; filename="backend-cv-2026.html"');
  });

  it("does not render someone else's resume", async () => {
    const r = await create(userA);
    expect((await request(app).get(`/api/resumes/${r.id}/preview`).set(as(userB))).status).toBe(404);
  });
});
