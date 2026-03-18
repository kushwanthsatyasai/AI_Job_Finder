import dotenv from 'dotenv';
import path from 'node:path';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ensureTestUser, login, requireAuth } from './auth.js';
import { loadDb, saveDb } from './db.js';
import { fetchJobs } from './jobs.js';
import { matchJobsToResume } from './matching.js';
import { runAssistant } from './assistant.js';
import { log } from './logger.js';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const require = createRequire(import.meta.url);

async function parsePdfBuffer(buf: Buffer): Promise<string> {
  // In some environments pdf-parse exports a PDFParse class (not a function).
  const mod: any = require('pdf-parse');
  const PDFParseCtor: any = mod?.PDFParse;
  if (typeof PDFParseCtor !== 'function') {
    throw new Error(`pdf-parse PDFParse ctor not found (keys: ${Object.keys(mod || {}).join(',')})`);
  }

  // The PDFParse class supports getText(); keep this minimal for resume parsing.
  const parser = new PDFParseCtor({ data: buf });
  const out: any = await parser.getText();
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object') {
    if (typeof out.text === 'string') return out.text;
    if (Array.isArray(out.text)) return out.text.join('\n');
    if (Array.isArray(out.pages)) {
      const maybe = out.pages.map((p: any) => p?.text).filter(Boolean);
      if (maybe.length) return maybe.join('\n');
    }
  }
  return '';
}

async function main() {
  const server = Fastify({
    logger: {
      transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    },
  });

  server.addHook('onRequest', async (req) => {
    server.log.debug({ reqId: req.id, method: req.method, url: req.url }, 'http.request');
  });
  server.addHook('onResponse', async (req, reply) => {
    server.log.debug({ reqId: req.id, statusCode: reply.statusCode }, 'http.response');
  });

  await server.register(cors, {
    origin: true,
    credentials: true,
  });

  await server.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  });

  await ensureTestUser();
  log.info(
    {
      hasAdzuna: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      hasGroq: Boolean(process.env.GROQ_API_KEY),
      hasSarvam: Boolean(process.env.SARVAM_API_KEY),
      llmPrimary: process.env.GROQ_API_KEY ? 'groq' : process.env.SARVAM_API_KEY ? 'sarvam' : 'none',
    },
    'server.boot: providers',
  );

  server.get('/health', async () => {
    return { ok: true };
  });

  server.post('/auth/login', async (req, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const session = await login(parsed.data.email, parsed.data.password);
    if (!session) return reply.code(401).send({ error: 'Invalid credentials' });
    server.log.info({ reqId: req.id, userId: session.userId }, 'auth.login');

    const db = await loadDb();
    const user = db.users[session.userId];
    return reply.send({
      token: session.token,
      user: { id: user.id, email: user.email, hasResume: Boolean(user.resumeText) },
    });
  });

  server.get('/me', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    server.log.debug({ reqId: req.id, userId: auth.userId }, 'auth.me');
    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return reply.send({ id: user.id, email: user.email, hasResume: Boolean(user.resumeText), resumeUpdatedAt: user.resumeUpdatedAt });
  });

  server.post('/resume', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Missing file' });

    const buf = await file.toBuffer();
    let resumeText = '';

    const mimetype = file.mimetype?.toLowerCase() ?? '';
    const filename = file.filename?.toLowerCase() ?? '';
    const isPdf = mimetype.includes('pdf') || filename.endsWith('.pdf');
    const isText = mimetype.includes('text') || filename.endsWith('.txt');

    if (isPdf) {
      try {
        resumeText = await parsePdfBuffer(buf);
      } catch (e: any) {
        server.log.error({ reqId: req.id, err: e?.message?.slice(0, 250) }, 'resume.pdf_parse_failed');
        return reply.code(500).send({ error: 'Failed to parse PDF resume. Please try uploading a .txt resume, or retry after restart.' });
      }
    } else if (isText) {
      resumeText = buf.toString('utf-8');
    } else {
      return reply.code(400).send({ error: 'Unsupported file type (upload PDF or TXT)' });
    }

    resumeText = resumeText.replace(/\s+/g, ' ').trim();
    if (!resumeText || resumeText === '[object Object]') {
      return reply.code(400).send({ error: 'Could not extract resume text from file. Please try a different PDF or upload a TXT resume.' });
    }
    server.log.info({ reqId: req.id, userId: auth.userId, chars: resumeText.length }, 'resume.upload');

    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });

    user.resumeText = resumeText;
    user.resumeUpdatedAt = new Date().toISOString();
    await saveDb(db);

    return reply.send({ ok: true, resumeUpdatedAt: user.resumeUpdatedAt });
  });

  server.get('/resume', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return reply.send({ hasResume: Boolean(user.resumeText), resumeUpdatedAt: user.resumeUpdatedAt });
  });

  server.get('/jobs', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const querySchema = z.object({
      what: z.string().optional(),
      where: z.string().optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    const query = parsed.success ? parsed.data : {};
    try {
      const jobs = await fetchJobs({ what: query.what, where: query.where });
      server.log.info({ reqId: req.id, userId: auth.userId, count: jobs.length }, 'jobs.list');
      return reply.send({ jobs });
    } catch (e: any) {
      server.log.error(e);
      return reply.code(500).send({ error: 'Failed to fetch jobs' });
    }
  });

  server.post('/match', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    const bodySchema = z.object({
      jobs: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          companyName: z.string(),
          location: z.string(),
          description: z.string(),
          jobType: z.string(),
          workMode: z.string(),
          postedAt: z.string(),
          applyUrl: z.string(),
          source: z.string(),
        }),
      ),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user?.resumeText) return reply.code(400).send({ error: 'Resume required' });

    try {
      const matches = await matchJobsToResume({ resumeText: user.resumeText, jobs: parsed.data.jobs as any });
      server.log.info({ reqId: req.id, userId: auth.userId, matches: matches.length }, 'match.jobs');
      return reply.send({ matches });
    } catch (e: any) {
      server.log.error(e);
      return reply.code(500).send({ error: 'Failed to match jobs' });
    }
  });

  server.get('/applications', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });
    server.log.debug({ reqId: req.id, userId: auth.userId, count: user.applications.length }, 'apps.list');
    return reply.send({ applications: user.applications });
  });

  server.post('/applications', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const bodySchema = z.object({
      jobId: z.string(),
      jobTitle: z.string(),
      companyName: z.string(),
      applyUrl: z.string().url(),
      appliedAt: z.string().datetime().optional(),
      action: z.enum(['YesApplied', 'AppliedEarlier']).optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const existing = user.applications.find((a) => a.jobId === parsed.data.jobId);
    if (existing) {
      server.log.info({ reqId: req.id, userId: auth.userId, jobId: parsed.data.jobId }, 'apps.create: deduped');
      return reply.send({ application: existing, deduped: true });
    }

    const now = new Date().toISOString();
    const createdAt = parsed.data.appliedAt ?? now;

    const app = {
      id: nanoid(),
      jobId: parsed.data.jobId,
      jobTitle: parsed.data.jobTitle,
      companyName: parsed.data.companyName,
      applyUrl: parsed.data.applyUrl,
      status: 'Applied' as const,
      createdAt,
      updatedAt: now,
      timeline: [
        { at: now, type: 'Created' as const, message: 'Added to applications.' },
        { at: now, type: 'StatusChange' as const, message: 'Status set to Applied.' },
      ],
    };

    user.applications.unshift(app);
    await saveDb(db);
    server.log.info({ reqId: req.id, userId: auth.userId, appId: app.id, jobId: app.jobId }, 'apps.create');
    return reply.send({ application: app });
  });

  server.patch('/applications/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const paramsSchema = z.object({ id: z.string() });
    const bodySchema = z.object({
      status: z.enum(['Applied', 'Interview', 'Offer', 'Rejected']),
    });
    const p = paramsSchema.safeParse(req.params);
    const b = bodySchema.safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: 'Invalid request' });

    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const app = user.applications.find((a) => a.id === p.data.id);
    if (!app) return reply.code(404).send({ error: 'Application not found' });

    const now = new Date().toISOString();
    app.status = b.data.status;
    app.updatedAt = now;
    app.timeline.push({ at: now, type: 'StatusChange', message: `Status set to ${b.data.status}.` });
    await saveDb(db);
    server.log.info({ reqId: req.id, userId: auth.userId, appId: app.id, status: app.status }, 'apps.status');
    return reply.send({ application: app });
  });

  server.post('/ai/assistant', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const bodySchema = z.object({
      message: z.string().min(1).max(2000),
      history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
        .max(20)
        .optional(),
      currentFilters: z.any().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

    try {
      const db = await loadDb();
      const user = db.users[auth.userId];
      if (!user) return reply.code(404).send({ error: 'User not found' });

      const stored = (user.assistantHistory || []).map((h) => ({ role: h.role, content: h.content }));
      const merged = [...stored, ...(parsed.data.history || [])].slice(-20);

      const res = await runAssistant({ message: parsed.data.message, history: merged });

      // Persist assistant memory (trim to last 30 turns).
      const now = new Date().toISOString();
      user.assistantHistory = [
        ...(user.assistantHistory || []),
        { role: 'user' as const, content: parsed.data.message, at: now },
        { role: 'assistant' as const, content: res.assistantText, at: now },
      ].slice(-60);
      await saveDb(db);
      server.log.info({ reqId: req.id, userId: auth.userId, actions: res.actions?.length || 0 }, 'assistant.reply');
      return reply.send(res);
    } catch (e: any) {
      server.log.error(e);
      return reply.code(500).send({ error: 'Assistant failed' });
    }
  });

  server.get('/ai/assistant/history', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const db = await loadDb();
    const user = db.users[auth.userId];
    if (!user) return reply.code(404).send({ error: 'User not found' });
    const history = (user.assistantHistory || []).slice(-20);
    return reply.send({ history });
  });

  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

void main();

