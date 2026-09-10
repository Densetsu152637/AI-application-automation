// Domain ports stay independent of framework, driver, filesystem and environment APIs.
export interface Clock { now(): Date; monotonicMilliseconds(): number; }
export interface OperationContext { correlationId: string; signal: AbortSignal; }

export type CriterionStrength = 'required' | 'preferred';
export type CriterionOutcome = 'pass' | 'fail' | 'unknown';
export type MatchDecision = 'match' | 'reject' | 'needs_review';
export interface Criterion { id: string; field: 'title' | 'arrangement' | 'category' | 'location' | 'keywords'; value: string; strength: CriterionStrength; }
export interface JobFacts { title: string; arrangement?: string | null; category?: string | null; location?: string | null; description?: string | null; }
export interface CriterionResult { criterionId: string; outcome: CriterionOutcome; reason: string; }

export function evaluateCriterion(criterion: Criterion, job: JobFacts): CriterionResult {
  const raw = criterion.field === 'title' ? job.title : criterion.field === 'keywords' ? job.description : job[criterion.field];
  if (!raw?.trim()) return { criterionId: criterion.id, outcome: 'unknown', reason: `${criterion.field} is unavailable` };
  const expected = criterion.value.trim().toLocaleLowerCase(); const actual = raw.toLocaleLowerCase();
  const pass = criterion.field === 'title' ? actual.includes(expected) : criterion.field === 'keywords' ? expected.split(/\s+/).every(word => actual.includes(word)) : actual === expected;
  return { criterionId: criterion.id, outcome: pass ? 'pass' : 'fail', reason: pass ? `${criterion.field} satisfies the criterion` : `${criterion.field} does not satisfy the criterion` };
}
export function decideMatch(criteria: Criterion[], results: CriterionResult[]): MatchDecision {
  const byId = new Map(results.map(result => [result.criterionId, result]));
  if (criteria.some(criterion => criterion.strength === 'required' && byId.get(criterion.id)?.outcome === 'fail')) return 'reject';
  if (criteria.some(criterion => criterion.strength === 'required' && byId.get(criterion.id)?.outcome !== 'pass')) return 'needs_review';
  return 'match';
}
export function normalizeListingUrl(input: string): string {
  const url = new URL(input); url.protocol = url.protocol.toLowerCase(); url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
  const kept = [...url.searchParams.entries()].filter(([key]) => !/^(utm_.*|gclid|fbclid)$/i.test(key)); url.search = ''; kept.forEach(([key, value]) => url.searchParams.append(key, value));
  return url.toString();
}
export { isPublicAddress, validateEgressUrl, validateResolvedEgressUrl } from './egress.ts';
