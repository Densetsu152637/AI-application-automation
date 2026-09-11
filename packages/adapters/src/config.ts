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
  INTERNAL_SECRET_FILE: file,
  LLM_BASE_URL: infrastructureUrl.default('http://inference:8000/v1'),
  LLM_MODEL_ID: z.string().trim().default('Qwen3.5-9B'),
  LLM_API_KEY_FILE: file.optional(),
  LLM_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  LLM_CONTEXT_TOKENS: z.coerce.number().int().min(4096).default(32768),
  LLM_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(2048),
  APP_TIMEZONE: z.string().default('UTC').refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  DB_BUSY_TIMEOUT_MS: z.coerce.number().pipe(z.literal(5000)).default(5000),
  DIAGNOSTIC_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  RUN_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RESOURCE_MAX_BYTES: z.coerce.number().pipe(z.literal(20971520)).default(20971520),
}).refine(v => v.LLM_OUTPUT_TOKENS <= v.LLM_CONTEXT_TOKENS / 2);
export function readDeployment() {
  const parsed = deploymentSchema.safeParse(process.env);
  if (!parsed.success) throw new Error('CONFIG_INVALID');
  const config = parsed.data;
  const internal = readFileSync(config.INTERNAL_SECRET_FILE, 'utf8').trim();
  if (internal.length < 32) throw new Error('SECRET_INVALID');
  if (config.LLM_API_KEY_FILE && !readFileSync(config.LLM_API_KEY_FILE, 'utf8').trim()) throw new Error('SECRET_INVALID');
  return config;
}
