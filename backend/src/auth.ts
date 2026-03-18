import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadDb, saveDb, type StoredUser } from './db';

const TEST_EMAIL = 'test@gmail.com';
const TEST_PASSWORD = 'test@123';

type Session = { token: string; userId: string; createdAt: number };
const sessions = new Map<string, Session>();

export async function ensureTestUser(): Promise<StoredUser> {
  const db = await loadDb();
  const existing = Object.values(db.users).find((u) => u.email === TEST_EMAIL);
  if (existing) return existing;

  const id = 'user_test';
  const user: StoredUser = {
    id,
    email: TEST_EMAIL,
    resumeText: null,
    resumeUpdatedAt: null,
    applications: [],
  };

  db.users[id] = user;
  await saveDb(db);
  return user;
}

export async function login(email: string, password: string) {
  await ensureTestUser();
  if (email !== TEST_EMAIL || password !== TEST_PASSWORD) {
    return null;
  }
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { token, userId: 'user_test', createdAt: Date.now() });
  return { token, userId: 'user_test' };
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): { userId: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    void reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  const session = sessions.get(token);
  if (!session) {
    void reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return { userId: session.userId };
}

