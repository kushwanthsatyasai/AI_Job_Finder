import { nanoid } from 'nanoid';
import { log } from './logger.js';

export type NormalizedJob = {
  id: string;
  title: string;
  companyName: string;
  location: string;
  description: string;
  jobType: 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Unknown';
  workMode: 'Remote' | 'Hybrid' | 'On-site' | 'Unknown';
  postedAt: string; // ISO
  applyUrl: string;
  source: 'adzuna' | 'mock';
};

function inferWorkMode(text: string): NormalizedJob['workMode'] {
  const t = text.toLowerCase();
  if (/\bremote\b/.test(t) || /\bremote[- ]first\b/.test(t) || /\bwork from home\b/.test(t) || /\bwork remotely\b/.test(t) || /\bwfh\b/.test(t)) return 'Remote';
  if (/\bhybrid\b/.test(t)) return 'Hybrid';
  if (/\bon[- ]site\b/.test(t) || /\bon site\b/.test(t) || /\bonsite\b/.test(t) || /\bin[- ]office\b/.test(t) || /\boffice[- ]based\b/.test(t)) return 'On-site';
  return 'Unknown';
}

function inferJobType(title: string, description: string, contractTime: string, contractType: string): NormalizedJob['jobType'] {
  const t = `${title}\n${description}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(t) || /\bgraduate\b/.test(t) || /\btrainee\b/.test(t)) return 'Internship';
  if (contractType.includes('contract') || /\bcontract\b/.test(t) || /\bfreelance\b/.test(t)) return 'Contract';
  if (contractTime.includes('part') || /\bpart[- ]time\b/.test(t)) return 'Part-time';
  if (contractTime.includes('full') || /\bfull[- ]time\b/.test(t) || /\bpermanent\b/.test(t)) return 'Full-time';
  return 'Unknown';
}

function normalizeAdzunaJob(j: any): NormalizedJob {
  const title = String(j?.title || '').trim();
  const companyName = String(j?.company?.display_name || '').trim() || 'Unknown';
  const location = String(j?.location?.display_name || '').trim() || 'Unknown';
  const description = String(j?.description || '').trim();
  const postedAt = j?.created ? new Date(j.created).toISOString() : new Date().toISOString();
  const applyUrl = String(j?.redirect_url || j?.adref || '').trim();

  const contractTime = String(j?.contract_time || '').toLowerCase();
  const contractType = String(j?.contract_type || '').toLowerCase();

  const jobType: NormalizedJob['jobType'] = inferJobType(title, description, contractTime, contractType);

  const blob = `${title}\n${description}\n${location}`;
  const workMode = inferWorkMode(blob);

  return {
    id: String(j?.id ?? nanoid()),
    title,
    companyName,
    location,
    description,
    jobType,
    workMode,
    postedAt,
    applyUrl,
    source: 'adzuna',
  };
}

let cached: { fetchedAt: number; jobs: NormalizedJob[] } | null = null;

export async function fetchJobs(params: { what?: string; where?: string }): Promise<NormalizedJob[]> {
  const ttlMs = 10 * 60 * 1000;
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    log.debug({ cached: true, count: cached.jobs.length }, 'jobs.fetch');
    return cached.jobs;
  }

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const country = process.env.ADZUNA_COUNTRY || 'in';

  if (!appId || !appKey) {
    log.warn('jobs.fetch: missing Adzuna keys, returning mock feed');
    const jobs: NormalizedJob[] = [
      {
        id: 'mock_1',
        title: 'Frontend Engineer (React)',
        companyName: 'Mock Labs',
        location: 'Bangalore, India',
        description: 'React, TypeScript, Node.js. Remote-friendly. Build UI and APIs.',
        jobType: 'Full-time',
        workMode: 'Remote',
        postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        applyUrl: 'https://example.com/apply/mock_1',
        source: 'mock',
      },
      {
        id: 'mock_2',
        title: 'Backend Developer (Node.js)',
        companyName: 'Example Corp',
        location: 'Mumbai, India',
        description: 'Fastify, PostgreSQL, APIs. On-site role. Docker is a plus.',
        jobType: 'Full-time',
        workMode: 'On-site',
        postedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        applyUrl: 'https://example.com/apply/mock_2',
        source: 'mock',
      },
    ];
    cached = { fetchedAt: Date.now(), jobs };
    log.info({ source: 'mock', count: jobs.length }, 'jobs.fetch');
    return jobs;
  }

  const what = params.what || 'software engineer';
  const where = params.where || 'India';
  const started = Date.now();
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('what', what);
  url.searchParams.set('where', where);
  url.searchParams.set('content-type', 'application/json');

  log.debug({ what, where, country }, 'adzuna.request');
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    log.error({ status: res.status, body: text.slice(0, 250) }, 'adzuna.error');
    throw new Error(`Adzuna error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as any;
  const results = Array.isArray(json?.results) ? json.results : [];
  const jobs = results.map(normalizeAdzunaJob).filter((j: NormalizedJob) => j.title && j.applyUrl);

  cached = { fetchedAt: Date.now(), jobs };
  log.info({ source: 'adzuna', count: jobs.length, ms: Date.now() - started }, 'jobs.fetch');
  return jobs;
}

