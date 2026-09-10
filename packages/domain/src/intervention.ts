/**
 * Pure domain rules for human browser interventions and viewer tickets.
 *
 * Persistence adapters should store `ViewerTicket.tokenHash`, never the
 * returned token.  The ledger below is intentionally adapter-shaped so the
 * same rules can be used with an in-memory test double or a database-backed
 * repository.
 */

export const INTERVENTION_CONTEXT_LIMIT = 8_192;
export const INTERVENTION_ACTION_LIMIT = 1_000;
export const VIEWER_TICKET_TTL_MS = 5 * 60 * 1_000;

export type InterventionState =
  | 'open'
  | 'takeover_requested'
  | 'suspended'
  | 'human_active'
  | 'resolving'
  | 'resolved'
  | 'cancelled'
  | 'expired';

export type InterventionResolution =
  | 'completed'
  | 'not_submitted'
  | 'submission_unknown'
  | 'dismissed';

export interface InterventionTask {
  readonly id: string;
  readonly targetId: string;
  readonly state: InterventionState;
  readonly requiredAction: string;
  readonly knownContext: Readonly<Record<string, string>>;
  readonly browserGeneration: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolution?: InterventionResolution;
  readonly resolutionNote?: string;
}

export type InterventionEvent =
  | { type: 'request_takeover' }
  | { type: 'suspend_automation' }
  | { type: 'begin_human_control' }
  | { type: 'begin_resolution' }
  | { type: 'resolve'; resolution: InterventionResolution; note?: string }
  | { type: 'cancel' }
  | { type: 'expire' };

export type InterventionErrorCode =
  | 'INVALID_INTERVENTION'
  | 'INVALID_TRANSITION'
  | 'TICKET_ALREADY_ISSUED'
  | 'TICKET_NOT_FOUND'
  | 'TICKET_EXPIRED'
  | 'TICKET_REPLAYED'
  | 'TICKET_REVOKED'
  | 'TICKET_BINDING_MISMATCH';

export class InterventionDomainError extends Error {
  readonly code: InterventionErrorCode;

  constructor(code: InterventionErrorCode, message: string) {
    super(message);
    this.name = 'InterventionDomainError';
    this.code = code;
  }
}

function fail(code: InterventionErrorCode, message: string): never {
  throw new InterventionDomainError(code, message);
}

function assertDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail('INVALID_INTERVENTION', `${field} must be a valid date`);
}

function contextSize(context: Readonly<Record<string, string>>): number {
  return Object.entries(context).reduce((size, [key, value]) => size + key.length + value.length, 0);
}

export function createIntervention(input: {
  id: string;
  targetId: string;
  requiredAction: string;
  knownContext?: Readonly<Record<string, string>>;
  browserGeneration: number;
  now?: Date;
}): InterventionTask {
  const now = input.now ?? new Date();
  assertDate(now, 'now');
  if (!input.id.trim() || !input.targetId.trim()) fail('INVALID_INTERVENTION', 'id and targetId are required');
  if (!input.requiredAction.trim() || input.requiredAction.length > INTERVENTION_ACTION_LIMIT) fail('INVALID_INTERVENTION', 'requiredAction is empty or too long');
  if (!Number.isSafeInteger(input.browserGeneration) || input.browserGeneration < 0) fail('INVALID_INTERVENTION', 'browserGeneration must be a non-negative integer');
  const knownContext = input.knownContext ?? {};
  if (Object.keys(knownContext).some(key => !key.trim() || typeof knownContext[key] !== 'string') || contextSize(knownContext) > INTERVENTION_CONTEXT_LIMIT) fail('INVALID_INTERVENTION', 'knownContext is invalid or too large');
  return { id: input.id, targetId: input.targetId, state: 'open', requiredAction: input.requiredAction, knownContext: { ...knownContext }, browserGeneration: input.browserGeneration, createdAt: new Date(now), updatedAt: new Date(now) };
}

export function transitionIntervention(task: InterventionTask, event: InterventionEvent, now = new Date()): InterventionTask {
  assertDate(now, 'now');
  const next: InterventionState | undefined =
    event.type === 'request_takeover' && task.state === 'open' ? 'takeover_requested' :
    event.type === 'suspend_automation' && task.state === 'takeover_requested' ? 'suspended' :
    event.type === 'begin_human_control' && task.state === 'suspended' ? 'human_active' :
    event.type === 'begin_resolution' && task.state === 'human_active' ? 'resolving' :
    event.type === 'resolve' && task.state === 'resolving' ? 'resolved' :
    event.type === 'cancel' && !['resolved', 'cancelled', 'expired'].includes(task.state) ? 'cancelled' :
    event.type === 'expire' && !['resolved', 'cancelled', 'expired'].includes(task.state) ? 'expired' : undefined;
  if (!next) fail('INVALID_TRANSITION', `${event.type} is not valid from ${task.state}`);
  if (event.type === 'resolve' && event.resolution === 'completed' && task.targetId.length === 0) fail('INVALID_TRANSITION', 'completed resolution requires a target');
  return { ...task, state: next, updatedAt: new Date(now), ...(event.type === 'resolve' ? { resolution: event.resolution, ...(event.note === undefined ? {} : { resolutionNote: event.note }) } : {}) };
}

export interface ViewerTicket {
  readonly tokenHash: string;
  readonly sessionId: string;
  readonly interventionId: string;
  readonly browserGeneration: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface IssuedViewerTicket {
  readonly token: string;
  readonly ticket: ViewerTicket;
}

export interface TicketCodec {
  hashToken(token: string): string;
  generateToken(): string;
}

export class ViewerTicketLedger {
  private readonly tickets = new Map<string, ViewerTicket>();
  private readonly codec: TicketCodec;

  constructor(codec: TicketCodec) { this.codec = codec; }

  issue(input: { sessionId: string; interventionId: string; browserGeneration: number; now?: Date; ttlMs?: number }): IssuedViewerTicket {
    const now = input.now ?? new Date();
    assertDate(now, 'now');
    if (!input.sessionId || !input.interventionId || !Number.isSafeInteger(input.browserGeneration) || input.browserGeneration < 0) fail('INVALID_INTERVENTION', 'invalid ticket binding');
    const ttl = input.ttlMs ?? VIEWER_TICKET_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0) fail('INVALID_INTERVENTION', 'ticket TTL must be positive');
    for (const ticket of this.tickets.values()) if (ticket.sessionId === input.sessionId && ticket.interventionId === input.interventionId && ticket.browserGeneration === input.browserGeneration && !ticket.consumedAt && !ticket.revokedAt && ticket.expiresAt > now) fail('TICKET_ALREADY_ISSUED', 'an active ticket already exists for this binding');
    const token = this.codec.generateToken();
    if (!token) fail('INVALID_INTERVENTION', 'ticket generator returned an empty token');
    const ticket: ViewerTicket = { tokenHash: this.codec.hashToken(token), sessionId: input.sessionId, interventionId: input.interventionId, browserGeneration: input.browserGeneration, issuedAt: new Date(now), expiresAt: new Date(now.getTime() + ttl), consumedAt: null, revokedAt: null };
    this.tickets.set(ticket.tokenHash, ticket);
    return { token, ticket };
  }

  consume(token: string, binding: { sessionId: string; interventionId: string; browserGeneration: number }, now = new Date()): ViewerTicket {
    assertDate(now, 'now');
    const hash = this.codec.hashToken(token);
    const current = this.tickets.get(hash);
    if (!current) fail('TICKET_NOT_FOUND', 'viewer ticket is invalid');
    if (current.revokedAt) fail('TICKET_REVOKED', 'viewer ticket has been revoked');
    if (current.consumedAt) fail('TICKET_REPLAYED', 'viewer ticket has already been consumed');
    if (current.expiresAt <= now) fail('TICKET_EXPIRED', 'viewer ticket has expired');
    if (current.sessionId !== binding.sessionId || current.interventionId !== binding.interventionId || current.browserGeneration !== binding.browserGeneration) fail('TICKET_BINDING_MISMATCH', 'viewer ticket binding does not match');
    const consumed = { ...current, consumedAt: new Date(now) };
    this.tickets.set(hash, consumed);
    return consumed;
  }

  revoke(token: string, now = new Date()): void {
    assertDate(now, 'now');
    const hash = this.codec.hashToken(token);
    const current = this.tickets.get(hash);
    if (!current) fail('TICKET_NOT_FOUND', 'viewer ticket is invalid');
    if (!current.revokedAt && !current.consumedAt) this.tickets.set(hash, { ...current, revokedAt: new Date(now) });
  }
}
