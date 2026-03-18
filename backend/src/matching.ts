import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { NormalizedJob } from './jobs.js';
import { log } from './logger.js';

export type ResumeProfile = {
  skills: string[];
  titles: string[];
  domains: string[];
  yearsExperience?: number;
};

export type JobMatch = {
  jobId: string;
  score: number;
  explanation: string;
  matchingSkills: string[];
  missingSkills: string[];
};

const resumeProfileSchema = z.object({
  skills: z.array(z.string()).default([]),
  titles: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  yearsExperience: z.number().int().min(0).max(60).optional(),
});

const refineSchema = z.object({
  score: z.number().min(0).max(100),
  explanation: z.string().min(1),
  matchingSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
});

function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function normToken(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9+.#-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── Embeddings layer ───────────────────────────────────────────── */

const embeddingCache = new Map<string, number[]>();
let embeddingsDisabled = false;

const LOCAL_EMBED_DIM = 256;

function localEmbed(text: string): number[] {
  const v = new Array<number>(LOCAL_EMBED_DIM).fill(0);
  const tokens = normToken(text)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  // Simple feature-hashing into a fixed-size vector.
  for (const tok of tokens) {
    const h = createHash('sha256').update(tok).digest();
    const idx = h.readUInt32LE(0) % LOCAL_EMBED_DIM;
    const sign = (h[4] & 1) === 0 ? 1 : -1;
    v[idx] += sign * 1;
  }

  // L2 normalize so cosine similarity behaves.
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
  return v;
}

function getEmbeddingsModel(model: string) {
  if (!process.env.GROQ_API_KEY) return null;
  return new OpenAIEmbeddings({
    openAIApiKey: process.env.GROQ_API_KEY,
    model,
    configuration: { baseURL: 'https://api.groq.com/openai/v1' },
  });
}

function getOpenAIEmbeddingsModel(model: string) {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    model,
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  // Preferred: Groq embeddings (if your Groq account supports it).
  // Fallback: OpenAI embeddings (if OPENAI_API_KEY is set).
  // Final: local feature-hash vectors (no API).

  const preferred = (process.env.GROQ_EMBEDDINGS_MODEL || 'nomic-embed-text-v1_5').trim();
  const modelCandidates = [
    preferred,
    ...(preferred !== 'nomic-embed-text-v1' ? ['nomic-embed-text-v1'] : []),
    ...(preferred !== 'text-embedding-3-small' ? ['text-embedding-3-small'] : []),
  ];

  const openaiModel = (process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small').trim();

  // If Groq embeddings are unavailable, prefer OpenAI; otherwise use local.
  if (!process.env.GROQ_API_KEY || embeddingsDisabled) {
    const openai = getOpenAIEmbeddingsModel(openaiModel);
    if (!openai) return texts.map(localEmbed);
    try {
      return await openai.embedDocuments(texts);
    } catch (err: any) {
      log.warn({ provider: 'openai', model: openaiModel, error: String(err?.message || err).slice(0, 200) }, 'match.embeddings: openai failed, using local fallback');
      return texts.map(localEmbed);
    }
  }

  const uncached: { idx: number; text: string }[] = [];
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i++) {
    const key = hashText(texts[i]).slice(0, 16);
    const cached = embeddingCache.get(key);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push({ idx: i, text: texts[i] });
    }
  }

  if (uncached.length > 0) {
    const batchSize = 50;
    let lastErr: any = null;
    let usedOpenAI = false;

    for (const modelName of modelCandidates) {
      const model = getEmbeddingsModel(modelName);
      if (!model) continue;
      try {
        for (let start = 0; start < uncached.length; start += batchSize) {
          const batch = uncached.slice(start, start + batchSize);
          const vecs = await model.embedDocuments(batch.map((u) => u.text));
          for (let j = 0; j < batch.length; j++) {
            const key = hashText(batch[j].text).slice(0, 16);
            embeddingCache.set(key, vecs[j]);
            results[batch[j].idx] = vecs[j];
          }
        }
        log.info({ model: modelName, embedded: uncached.length }, 'match.embeddings: model ok');
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || err);
        log.warn({ model: modelName, error: msg.slice(0, 200) }, 'match.embeddings: model failed');
        if (msg.includes('MODEL_NOT_FOUND') || msg.includes('does not exist') || msg.includes('do not have access')) {
          // If the account has no embedding models at all, disable further attempts for this process.
          embeddingsDisabled = true;
          break;
        }
        // Try next candidate model.
      }
    }

    // If Groq embeddings are disabled (or failed), try OpenAI embeddings for only the missing texts.
    if ((!embeddingsDisabled && lastErr) || embeddingsDisabled) {
      const openai = getOpenAIEmbeddingsModel(openaiModel);
      if (openai) {
        try {
          for (let start = 0; start < uncached.length; start += batchSize) {
            const batch = uncached.slice(start, start + batchSize);
            const vecs = await openai.embedDocuments(batch.map((u) => u.text));
            for (let j = 0; j < batch.length; j++) {
              const key = hashText(batch[j].text).slice(0, 16);
              embeddingCache.set(key, vecs[j]);
              results[batch[j].idx] = vecs[j];
            }
          }
          usedOpenAI = true;
          lastErr = null;
          log.info({ provider: 'openai', model: openaiModel, embedded: uncached.length }, 'match.embeddings: openai ok');
        } catch (err: any) {
          lastErr = err;
          log.warn({ provider: 'openai', model: openaiModel, error: String(err?.message || err).slice(0, 200) }, 'match.embeddings: openai failed');
        }
      }
    }

    if (!usedOpenAI && (embeddingsDisabled || lastErr)) {
      // Populate missing results with local vectors so caller can still rank.
      for (const u of uncached) {
        const vec = localEmbed(u.text);
        const key = hashText(u.text).slice(0, 16);
        embeddingCache.set(key, vec);
        results[u.idx] = vec;
      }
      if (lastErr) {
        log.warn({ error: String(lastErr?.message || lastErr).slice(0, 200) }, 'match.embeddings: using local fallback');
      }
    }
  }

  return results;
}

function jobEmbedText(job: NormalizedJob): string {
  return `${job.title} at ${job.companyName}. ${job.description.slice(0, 500)}`;
}

/* ── Heuristic helpers ──────────────────────────────────────────── */

const KNOWN_SKILLS = [
  'react','node','node.js','typescript','javascript','python','fastify','express',
  'next.js','sql','postgresql','mongodb','docker','kubernetes','aws','azure','gcp',
  'langchain','langgraph','pytorch','tensorflow','java','go','golang','rust','c++',
  'flutter','dart','angular','vue','svelte','redis','graphql','django','flask',
  'spring','ruby','rails','php','laravel','swift','kotlin',
];

const SKILL_DISPLAY: Record<string, string> = {
  react:'React', typescript:'TypeScript', javascript:'JavaScript', python:'Python',
  'node.js':'Node.js', node:'Node.js', fastify:'Fastify', express:'Express',
  'next.js':'Next.js', sql:'SQL', postgresql:'PostgreSQL', mongodb:'MongoDB',
  docker:'Docker', kubernetes:'Kubernetes', aws:'AWS', azure:'Azure', gcp:'GCP',
  langchain:'LangChain', langgraph:'LangGraph', pytorch:'PyTorch', tensorflow:'TensorFlow',
  java:'Java', go:'Go', golang:'Go', rust:'Rust', 'c++':'C++',
  flutter:'Flutter', dart:'Dart', angular:'Angular', vue:'Vue', svelte:'Svelte',
  redis:'Redis', graphql:'GraphQL', django:'Django', flask:'Flask',
  spring:'Spring', ruby:'Ruby', rails:'Rails', php:'PHP', laravel:'Laravel',
  swift:'Swift', kotlin:'Kotlin',
};

function extractSkillsFromText(text: string): string[] {
  const t = normToken(text);
  const found = KNOWN_SKILLS.filter((s) => t.includes(normToken(s)));
  return [...new Set(found.map((s) => SKILL_DISPLAY[s] || s))];
}

const SENIOR_SIGNALS = /\b(senior|sr\.?|lead|principal|staff|manager|director|head of|architect|vp|10\+|8\+|7\+|6\+|5\+)\b/i;
const JUNIOR_SIGNALS = /\b(junior|jr\.?|entry[- ]level|fresher|intern|trainee|associate|graduate|apprentice)\b/i;

function heuristicMatch(profile: ResumeProfile, job: NormalizedJob, resumeText: string): {
  score: number; explanation: string; matchingSkills: string[]; missingSkills: string[];
} {
  const resumeSkillsNorm = profile.skills.map(normToken).filter(Boolean);
  const jobText = normToken(`${job.title}\n${job.description}`);
  const jobSkills = extractSkillsFromText(`${job.title}\n${job.description}`);

  const matchingSkills = profile.skills.filter((sk) => jobText.includes(normToken(sk)));
  const missingSkills = jobSkills.filter((sk) => !resumeSkillsNorm.includes(normToken(sk)));

  let score = Math.min(50, matchingSkills.length * 10);
  const titleHit = profile.titles.some((t) => normToken(t) && jobText.includes(normToken(t)));
  if (titleHit) score += 10;

  const isFresher = (profile.yearsExperience ?? -1) <= 1 || profile.titles.some((t) => JUNIOR_SIGNALS.test(t));
  if (isFresher && SENIOR_SIGNALS.test(`${job.title} ${job.description}`)) score = Math.max(0, score - 25);
  if (isFresher && JUNIOR_SIGNALS.test(`${job.title} ${job.description}`)) score += 10;

  score = Math.min(55, score);

  const parts: string[] = [];
  if (matchingSkills.length) parts.push(`Your ${matchingSkills.slice(0, 3).join(', ')} skills align with this role.`);
  if (titleHit) parts.push('Role title matches your experience.');
  if (isFresher && SENIOR_SIGNALS.test(job.title)) parts.push('This role may require more experience than your profile shows.');
  if (!parts.length) parts.push('Some keyword overlap between your resume and this job description.');

  return {
    score,
    explanation: parts.join(' '),
    matchingSkills: [...new Set(matchingSkills)].slice(0, 8),
    missingSkills: [...new Set(missingSkills)].slice(0, 6),
  };
}

/* ── Profile extraction ─────────────────────────────────────────── */

const profileCache = new Map<string, ResumeProfile>();
const matchCache = new Map<string, Map<string, JobMatch>>();

function fallbackProfile(resumeText: string): ResumeProfile {
  return {
    skills: extractSkillsFromText(resumeText),
    titles: [],
    domains: [],
    yearsExperience: undefined,
  };
}

async function extractResumeProfile(resumeText: string): Promise<ResumeProfile> {
  const key = hashText(resumeText);
  const cached = profileCache.get(key);
  if (cached) {
    log.debug({ resumeHash: key.slice(0, 8), cached: true }, 'match.profile');
    return cached;
  }

  if (!process.env.GROQ_API_KEY && !process.env.SARVAM_API_KEY) {
    const profile = fallbackProfile(resumeText);
    profileCache.set(key, profile);
    return profile;
  }

  const providers = [
    ...(process.env.GROQ_API_KEY
      ? [{ name: 'groq', llm: new ChatGroq({ apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', temperature: 0.1 }) }]
      : []),
    ...(process.env.SARVAM_API_KEY
      ? [{ name: 'sarvam', llm: new ChatOpenAI({ apiKey: process.env.SARVAM_API_KEY, model: process.env.SARVAM_MODEL || 'sarvam-30b', temperature: 0.1, configuration: { baseURL: 'https://api.sarvam.ai/v1' } }) }]
      : []),
  ];

  for (const { name, llm } of providers) {
    try {
      const started = Date.now();
      const structured = llm.withStructuredOutput(resumeProfileSchema);
      const raw = await structured.invoke([
        { role: 'system', content: 'Extract a concise resume profile. Be conservative: only include skills/titles clearly present. Use canonical names (e.g., React, Node.js, Python). For yearsExperience: use 0 for freshers/recent graduates/students, and the actual number if stated. Titles should include seniority (e.g., "Junior Developer", "Fresher", "Intern") if applicable.' },
        { role: 'user', content: resumeText.slice(0, 12000) },
      ]);
      const profile: ResumeProfile = { skills: raw.skills ?? [], titles: raw.titles ?? [], domains: raw.domains ?? [], yearsExperience: raw.yearsExperience };
      profileCache.set(key, profile);
      log.info({ provider: name, resumeHash: key.slice(0, 8), skills: profile.skills.length, titles: profile.titles.length, ms: Date.now() - started }, 'match.profile: llm extracted');
      return profile;
    } catch (err: any) {
      log.warn({ provider: name, resumeHash: key.slice(0, 8), error: err?.message?.slice(0, 200) }, 'match.profile: provider failed, trying next');
    }
  }

  const profile = fallbackProfile(resumeText);
  profileCache.set(key, profile);
  log.warn({ resumeHash: key.slice(0, 8), skills: profile.skills.length }, 'match.profile: all providers failed, heuristic fallback');
  return profile;
}

/* ── LLM refinement (Stage 2) ───────────────────────────────────── */

async function refineWithLLM(args: {
  resumeProfile: ResumeProfile;
  job: NormalizedJob;
}): Promise<{ score: number; explanation: string; matchingSkills: string[]; missingSkills: string[] } | null> {
  if (!process.env.GROQ_API_KEY && !process.env.SARVAM_API_KEY) return null;

  const providers = [
    ...(process.env.GROQ_API_KEY
      ? [{ name: 'groq', llm: new ChatGroq({ apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', temperature: 0.2 }) }]
      : []),
    ...(process.env.SARVAM_API_KEY
      ? [{ name: 'sarvam', llm: new ChatOpenAI({ apiKey: process.env.SARVAM_API_KEY, model: process.env.SARVAM_MODEL || 'sarvam-30b', temperature: 0.2, configuration: { baseURL: 'https://api.sarvam.ai/v1' } }) }]
      : []),
  ];

  const payload = JSON.stringify({
    resumeProfile: args.resumeProfile,
    job: { title: args.job.title, companyName: args.job.companyName, location: args.job.location, jobType: args.job.jobType, workMode: args.job.workMode, description: args.job.description.slice(0, 4000) },
  }, null, 2);

  for (const { name, llm } of providers) {
    try {
      const started = Date.now();
      // Avoid tool-calling validation errors by requesting strict JSON and parsing ourselves.
      const resMsg: any = await llm.invoke([
        { role: 'system', content: `Score how well a job matches a candidate's resume.

Return STRICT JSON only, matching this shape exactly:
{ "score": number, "explanation": string, "matchingSkills": string[], "missingSkills": string[] }

Rules:
- EXPERIENCE LEVEL IS CRITICAL: fresher/0-1 years + "Senior"/"Lead"/"5+ years" job => score < 30.
- Fresher + "Junior"/"Intern"/"Entry-level" => boost.
- Use matchingSkills/missingSkills as concise canonical skill names.
- If matchingSkills has 0-1 items, score should usually be below 45 unless the job is explicitly entry-level and adjacent.
- If the job lists 5+ years (or senior signals) and candidate is fresher, score MUST be below 30.
- explanation must be 1-2 sentences (not a list).

Do not include markdown, no extra keys.` },
        { role: 'user', content: payload },
      ]);

      const text = typeof resMsg?.content === 'string' ? resMsg.content : String(resMsg?.content ?? '');
      // Some models may accidentally emit multiple JSON-like blocks; take the LAST one.
      const matches = Array.from(text.matchAll(/\{[\s\S]*?\}/g)) as RegExpMatchArray[];
      const last = matches.length ? (matches[matches.length - 1]?.[0] ?? null) : null;
      if (!last) throw new Error('LLM did not return JSON');
      const parsed = JSON.parse(last);
      const validated = refineSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(`LLM JSON failed schema: ${validated.error.issues[0]?.message || 'invalid'}`);
      }

      log.debug({ provider: name, jobId: args.job.id, score: validated.data.score, ms: Date.now() - started }, 'match.refine: llm');
      return {
        score: validated.data.score,
        explanation: validated.data.explanation,
        matchingSkills: validated.data.matchingSkills ?? [],
        missingSkills: validated.data.missingSkills ?? [],
      };
    } catch (err: any) {
      log.warn({ provider: name, jobId: args.job.id, error: err?.message?.slice(0, 150) }, 'match.refine: provider failed, trying next');
    }
  }

  log.warn({ jobId: args.job.id }, 'match.refine: all providers failed, using baseline');
  return null;
}

/* ── Concurrency helper ─────────────────────────────────────────── */

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/* ── Main hybrid pipeline ───────────────────────────────────────── */

const LLM_REFINE_COUNT = 20;

export async function matchJobsToResume(args: { resumeText: string; jobs: NormalizedJob[] }): Promise<JobMatch[]> {
  const startedAll = Date.now();
  const resumeHash = hashText(args.resumeText);
  const byJob = matchCache.get(resumeHash) ?? new Map<string, JobMatch>();
  matchCache.set(resumeHash, byJob);

  const profile = await extractResumeProfile(args.resumeText);
  const pending = args.jobs.filter((j) => !byJob.has(j.id));
  log.info({ resumeHash: resumeHash.slice(0, 8), jobs: args.jobs.length, pending: pending.length, cached: args.jobs.length - pending.length }, 'match.start');

  if (!pending.length) {
    const all = args.jobs.map((j) => byJob.get(j.id)).filter(Boolean) as JobMatch[];
    all.sort((a, b) => (b.score - a.score) || a.jobId.localeCompare(b.jobId));
    log.info({ resumeHash: resumeHash.slice(0, 8), returned: all.length, ms: Date.now() - startedAll }, 'match.done (cached)');
    return all;
  }

  // Stage 1: Embedding similarity for fast ranking
  let ranked: { job: NormalizedJob; similarity: number }[];
  try {
    const embStarted = Date.now();
    const resumeEmbedText = `${profile.skills.join(', ')}. ${profile.titles.join(', ')}. ${args.resumeText.slice(0, 800)}`;
    const textsToEmbed = [resumeEmbedText, ...pending.map(jobEmbedText)];
    const vectors = await embedTexts(textsToEmbed);

    if (vectors[0]?.length > 0) {
      const resumeVec = vectors[0];
      ranked = pending.map((job, i) => ({
        job,
        similarity: cosineSimilarity(resumeVec, vectors[i + 1] ?? []),
      }));
      ranked.sort((a, b) => b.similarity - a.similarity);
      log.info({ count: pending.length, ms: Date.now() - embStarted }, 'match.embeddings: done');
    } else {
      // If embeddings aren't available, use heuristic score to pick the best 20 for LLM.
      ranked = pending
        .map((job) => ({ job, similarity: heuristicMatch(profile, job, args.resumeText).score / 100 }))
        .sort((a, b) => b.similarity - a.similarity);
      log.warn('match.embeddings: no vectors returned, using heuristic ranking');
    }
  } catch (err: any) {
    log.warn({ error: err?.message?.slice(0, 200) }, 'match.embeddings: failed, falling back to heuristic ordering');
    ranked = pending
      .map((job) => ({ job, similarity: heuristicMatch(profile, job, args.resumeText).score / 100 }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  // Stage 2: LLM scoring on top N, heuristic for the rest
  const hasLLM = Boolean(process.env.GROQ_API_KEY || process.env.SARVAM_API_KEY);
  const topN = ranked.slice(0, hasLLM ? LLM_REFINE_COUNT : 0);
  const rest = ranked.slice(hasLLM ? LLM_REFINE_COUNT : 0);

  await mapWithConcurrency(topN, 5, async ({ job, similarity }) => {
    const llm = await refineWithLLM({ resumeProfile: profile, job });
    if (llm) {
      const match: JobMatch = { jobId: job.id, score: Math.round(llm.score), explanation: llm.explanation, matchingSkills: llm.matchingSkills, missingSkills: llm.missingSkills };
      byJob.set(job.id, match);
    } else {
      const h = heuristicMatch(profile, job, args.resumeText);
      const embBoost = Math.round(similarity * 20);
      const match: JobMatch = { jobId: job.id, score: Math.min(55, h.score + embBoost), explanation: h.explanation, matchingSkills: h.matchingSkills, missingSkills: h.missingSkills };
      byJob.set(job.id, match);
    }
  });

  for (const { job, similarity } of rest) {
    const h = heuristicMatch(profile, job, args.resumeText);
    const embScore = Math.round(Math.min(55, similarity * 60));
    const finalScore = Math.max(h.score, embScore);
    const match: JobMatch = { jobId: job.id, score: finalScore, explanation: h.explanation, matchingSkills: h.matchingSkills, missingSkills: h.missingSkills };
    byJob.set(job.id, match);
  }

  // Also handle the case where no embeddings and no LLM
  if (!hasLLM && ranked.every((r) => r.similarity === 0)) {
    for (const { job } of ranked) {
      if (!byJob.has(job.id)) {
        const h = heuristicMatch(profile, job, args.resumeText);
        byJob.set(job.id, { jobId: job.id, score: h.score, explanation: h.explanation, matchingSkills: h.matchingSkills, missingSkills: h.missingSkills });
      }
    }
  }

  const all = args.jobs.map((j) => byJob.get(j.id)).filter(Boolean) as JobMatch[];
  all.sort((a, b) => (b.score - a.score) || a.jobId.localeCompare(b.jobId));
  log.info({ resumeHash: resumeHash.slice(0, 8), returned: all.length, llmRefined: topN.length, embeddingOnly: rest.length, ms: Date.now() - startedAll }, 'match.done');
  return all;
}
