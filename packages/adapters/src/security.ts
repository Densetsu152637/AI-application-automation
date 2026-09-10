import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function token(): string { return randomBytes(32).toString('hex'); }
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
