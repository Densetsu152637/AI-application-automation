import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export type EgressDecision = { allowed: true; hostname: string; port: number } | { allowed: false; code: 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'PRIVATE_ADDRESS' | 'INVALID_PORT' | 'DNS_FAILED' | 'DNS_PRIVATE_ADDRESS' };
function ipv4Private(address: string): boolean { const p = address.split('.').map(Number); const [a, b, c] = p; if (p.length !== 4 || a === undefined || b === undefined || c === undefined || p.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true; return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) || a === 198 && (b === 18 || b === 19 || b === 51) || a >= 224; }
function ipv6Private(address: string): boolean { const normalized = address.toLowerCase().replace(/^\[|\]$/g, ''); if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return true; const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); return !!mapped && mapped[1] !== undefined && ipv4Private(mapped[1]); }
export function isPublicAddress(address: string): boolean { const kind = isIP(address); return kind === 4 ? !ipv4Private(address) : kind === 6 ? !ipv6Private(address) : false; }
export function validateEgressUrl(input: string, allowedOrigins: readonly string[]): EgressDecision {
  let url: URL; try { url = new URL(input); } catch { return { allowed: false, code: 'INVALID_URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { allowed: false, code: 'UNSUPPORTED_PROTOCOL' };
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80; if (!Number.isInteger(port) || port < 1 || port > 65535) return { allowed: false, code: 'INVALID_PORT' };
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) return { allowed: false, code: 'PRIVATE_ADDRESS' };
  if (!allowedOrigins.some(origin => { try { return new URL(origin).origin === url.origin; } catch { return false; } })) return { allowed: false, code: 'INVALID_URL' };
  return { allowed: true, hostname, port };
}

/** Resolve immediately before a browser request so DNS answers are part of the decision. */
export async function validateResolvedEgressUrl(
  input: string,
  allowedOrigins: readonly string[],
  resolver: (hostname: string) => Promise<readonly string[]> = async hostname => (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address),
): Promise<EgressDecision> {
  const decision = validateEgressUrl(input, allowedOrigins);
  if (!decision.allowed) return decision;
  if (isIP(decision.hostname)) return decision;
  let addresses: readonly string[];
  try { addresses = await resolver(decision.hostname); } catch { return { allowed: false, code: 'DNS_FAILED' }; }
  if (addresses.length === 0) return { allowed: false, code: 'DNS_FAILED' };
  if (addresses.some(address => !isPublicAddress(address))) return { allowed: false, code: 'DNS_PRIVATE_ADDRESS' };
  return decision;
}
