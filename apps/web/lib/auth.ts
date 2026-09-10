import { cookies } from 'next/headers';
import { readFileSync } from 'node:fs';
import { createSession, ensureAdministrator, sessionIsValid } from '@aaa/adapters/repositories';
import { appDb, runtimeConfig } from './server.ts';

export const cookieName = 'aaa_session';
export async function sessionToken(): Promise<string | null> { return (await cookies()).get(cookieName)?.value ?? null; }
export async function requireSession(): Promise<boolean> {
  const raw = await sessionToken();
  if (!raw) return false;
  const db = appDb(); try { return sessionIsValid(db, raw); } finally { db.close(); }
}
export function login(secret: string): string | null {
  const cfg = runtimeConfig(); const db = appDb();
  try { ensureAdministrator(db, readSecret(cfg.ADMIN_SECRET_FILE)); return createSession(db, secret); } finally { db.close(); }
}
function readSecret(path: string): string { return readFileSync(path, 'utf8').trim(); }
