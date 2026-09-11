export const cookieName = 'aaa_session';
/** Stable local principal; legacy cookies never split idempotency scopes. */
export async function sessionToken(): Promise<string> { return 'local'; }
export async function requireSession(): Promise<boolean> { return true; }
