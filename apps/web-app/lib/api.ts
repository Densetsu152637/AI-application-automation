import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { apiSchemaVersion, requestIdSchema, type ApiErrorDetail } from '@aaa/contracts';
import { runtimeConfig } from './server.ts';

type IdempotencyReplay = { status: number; body: unknown };
export type RequestId = `${string}-${string}-${string}-${string}-${string}`;
export function requestId(request?: Request): RequestId { const value = request?.headers.get('x-request-id'); return (value && requestIdSchema.safeParse(value).success ? value : randomUUID()) as RequestId; }
function responseHeaders(id: string): HeadersInit { return { 'Cache-Control': 'private, no-store', 'X-Request-Id': id }; }
export function apiOk<T>(data: T, status = 200, id = randomUUID()) { return NextResponse.json({ schemaVersion: apiSchemaVersion, data, requestId: id }, { status, headers: responseHeaders(id) }); }
export function apiList<T>(items: T[], nextCursor: string | null = null, status = 200, id = randomUUID()) { return apiOk({ items, nextCursor }, status, id); }
export function apiError(code: string, status: number, id = randomUUID(), options?: Partial<ApiErrorDetail>) { const error: ApiErrorDetail = { code, message: options?.message ?? code, retryable: options?.retryable ?? status >= 500, entityId: options?.entityId ?? null, details: options?.details ?? [] }; return NextResponse.json({ schemaVersion: apiSchemaVersion, error, requestId: id }, { status, headers: responseHeaders(id) }); }
export function requireMutationOrigin(request: Request): boolean { return request.headers.get('origin') === runtimeConfig().APP_ORIGIN; }
export function idempotencyKey(request: Request): string | null { const value = request.headers.get('idempotency-key'); return value && /^[\x21-\x7e]{16,128}$/.test(value) ? value : null; }
export function bodyHash(body: unknown): string { return createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
export function idempotencyScope(request: Request, route: string, principal: string): string { return `${principal}:${request.method}:${route}`; }
export function findIdempotency(db: Database.Database, scope: string, key: string, hash: string): IdempotencyReplay | 'CONFLICT' | null { const row = db.prepare('SELECT body_hash,status,response_json FROM api_idempotency_records WHERE scope=? AND idempotency_key=?').get(scope, key) as { body_hash: string; status: number; response_json: string } | undefined; if (!row) return null; if (row.body_hash !== hash) return 'CONFLICT'; return { status: row.status, body: JSON.parse(row.response_json) }; }
export function saveIdempotency(db: Database.Database, scope: string, key: string, hash: string, status: number, body: unknown, now: string) { db.prepare('INSERT INTO api_idempotency_records (scope,idempotency_key,body_hash,status,response_json,created_at) VALUES (?,?,?,?,?,?)').run(scope, key, hash, status, JSON.stringify(body), now); }
