import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
const infrastructureUrl = z.url().refine(value => {
  const u = new URL(value);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
});
const file = z.string().refine(isAbsolute);
export const deploymentSchema = z.object({
  APP_ORIGIN: infrastructureUrl.default('http://localhost:3000').refine(v => new URL(v).pathname === '/'),
  ADMIN_SECRET_FILE: file, INTERNAL_SECRET_FILE: file,
  LM_BASE_URL: infrastructureUrl.default('http://host.docker.internal:1234/v1'),
  LM_MODEL_ID: z.string().trim().default(''),
  LM_API_KEY_FILE: file.optional(),
  LM_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  LM_CONTEXT_TOKENS: z.coerce.number().int().min(4096).default(8192),
  LM_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(2048),
  APP_TIMEZONE: z.string().default('UTC').refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  DB_BUSY_TIMEOUT_MS: z.coerce.number().pipe(z.literal(5000)).default(5000),
  DIAGNOSTIC_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  RUN_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RESOURCE_MAX_BYTES: z.coerce.number().pipe(z.literal(20971520)).default(20971520),
}).refine(v => v.LM_OUTPUT_TOKENS <= v.LM_CONTEXT_TOKENS / 2);
export function readDeployment() {
  const parsed = deploymentSchema.safeParse(process.env);
  if (!parsed.success) throw new Error('CONFIG_INVALID');
  const config = parsed.data;
  const admin = readFileSync(config.ADMIN_SECRET_FILE, 'utf8').trim();
  const internal = readFileSync(config.INTERNAL_SECRET_FILE, 'utf8').trim();
  if (admin.length < 32 || internal.length < 32 || admin === internal) throw new Error('SECRET_INVALID');
  if (config.LM_API_KEY_FILE && !readFileSync(config.LM_API_KEY_FILE, 'utf8').trim()) throw new Error('SECRET_INVALID');
  return config;
}
