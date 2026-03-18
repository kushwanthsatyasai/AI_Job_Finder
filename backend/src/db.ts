import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log } from './logger';

export type ApplicationStatus = 'Applied' | 'Interview' | 'Offer' | 'Rejected';

export type ApplicationTimelineEvent = {
  at: string; // ISO
  type: 'StatusChange' | 'Note' | 'Created';
  message: string;
};

export type StoredApplication = {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  applyUrl: string;
  status: ApplicationStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  timeline: ApplicationTimelineEvent[];
};

export type StoredUser = {
  id: string;
  email: string;
  resumeText: string | null;
  resumeUpdatedAt: string | null;
  applications: StoredApplication[];
  assistantHistory?: { role: 'user' | 'assistant'; content: string; at: string }[];
};

export type DbShape = {
  users: Record<string, StoredUser>;
};

const DB_DIR = path.resolve(process.cwd(), '..', 'data');
const DB_PATH = path.join(DB_DIR, 'users.json');

const EMPTY_DB: DbShape = { users: {} };

async function ensureDbFile() {
  await fs.mkdir(DB_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    log.info({ dbPath: DB_PATH }, 'db.init: creating users.json');
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), 'utf-8');
  }
}

export async function loadDb(): Promise<DbShape> {
  const started = Date.now();
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as DbShape;
    if (!parsed || typeof parsed !== 'object' || !parsed.users) return EMPTY_DB;
    log.debug({ ms: Date.now() - started, userCount: Object.keys(parsed.users).length }, 'db.load');
    return parsed;
  } catch {
    log.warn({ ms: Date.now() - started }, 'db.load: parse failed, using empty db');
    return EMPTY_DB;
  }
}

export async function saveDb(db: DbShape): Promise<void> {
  const started = Date.now();
  await ensureDbFile();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  log.debug({ ms: Date.now() - started, userCount: Object.keys(db.users).length }, 'db.save');
}

