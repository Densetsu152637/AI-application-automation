import {
  decideMatch,
  evaluateCriterion,
  type Criterion,
  type CriterionResult,
  type JobFacts,
  type MatchDecision,
} from './index.ts';

/** The deliberately small, framework-independent boundary for local inference. */
export interface RelevanceResultAdapterInput {
  readonly job: JobFacts;
  readonly criteria: readonly Criterion[];
  readonly deterministicResults: readonly CriterionResult[];
}

export interface RelevanceResultAdapterOutput {
  /** Must contain exactly one result for every input criterion. */
  readonly criteria: readonly CriterionResult[];
  readonly summary: string;
}

export type RelevanceResultAdapter = (
  input: RelevanceResultAdapterInput,
) => Promise<RelevanceResultAdapterOutput>;

export interface MatchingAssessment {
  readonly decision: MatchDecision;
  readonly results: readonly CriterionResult[];
  readonly summary: string;
  readonly modelUsed: boolean;
}

export class InvalidRelevanceResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRelevanceResultError';
  }
}

function validateCriterionSet(criteria: readonly Criterion[]): void {
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (!criterion.id.trim()) throw new InvalidRelevanceResultError('criterion id is required');
    if (ids.has(criterion.id)) throw new InvalidRelevanceResultError(`duplicate criterion: ${criterion.id}`);
    ids.add(criterion.id);
  }
}

function validateCompleteCoverage(
  criteria: readonly Criterion[],
  results: readonly CriterionResult[],
): CriterionResult[] {
  const expected = new Set(criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  for (const result of results) {
    if (!expected.has(result.criterionId)) {
      throw new InvalidRelevanceResultError(`result references unknown criterion: ${result.criterionId}`);
    }
    if (seen.has(result.criterionId)) {
      throw new InvalidRelevanceResultError(`duplicate result: ${result.criterionId}`);
    }
    if (!['pass', 'fail', 'unknown'].includes(result.outcome)) {
      throw new InvalidRelevanceResultError(`invalid outcome for criterion: ${result.criterionId}`);
    }
    if (!result.reason.trim()) {
      throw new InvalidRelevanceResultError(`reason is required for criterion: ${result.criterionId}`);
    }
    seen.add(result.criterionId);
  }
  if (seen.size !== expected.size || [...expected].some((id) => !seen.has(id))) {
    throw new InvalidRelevanceResultError('relevance results must cover every criterion exactly once');
  }
  return criteria.map((criterion) => results.find((result) => result.criterionId === criterion.id)!);
}

/**
 * Runs deterministic matching first and optionally asks a model to interpret
 * only unresolved criteria. The returned decision is always computed by code.
 */
export async function orchestrateMatching(
  criteria: readonly Criterion[],
  job: JobFacts,
  relevanceAdapter?: RelevanceResultAdapter,
): Promise<MatchingAssessment> {
  validateCriterionSet(criteria);
  const deterministicResults = criteria.map((criterion) => evaluateCriterion(criterion, job));

  // A deterministic required failure is conclusive and must not incur a model call.
  if (decideMatch([...criteria], [...deterministicResults]) === 'reject') {
    return { decision: 'reject', results: deterministicResults, summary: 'A required criterion failed deterministically.', modelUsed: false };
  }

  const hasUnknown = deterministicResults.some((result) => result.outcome === 'unknown');
  if (!hasUnknown || !relevanceAdapter) {
    return {
      decision: decideMatch([...criteria], [...deterministicResults]),
      results: deterministicResults,
      summary: hasUnknown ? 'Required information is unavailable for review.' : 'All criteria evaluated deterministically.',
      modelUsed: false,
    };
  }

  const model = await relevanceAdapter({ job, criteria, deterministicResults });
  if (!model || !Array.isArray(model.criteria) || typeof model.summary !== 'string') {
    throw new InvalidRelevanceResultError('relevance adapter returned an invalid response');
  }
  const modelResults = validateCompleteCoverage(criteria, model.criteria);
  const deterministicById = new Map(deterministicResults.map((result) => [result.criterionId, result]));
  const merged = modelResults.map((result) => {
    const deterministic = deterministicById.get(result.criterionId)!;
    // The model cannot overturn a known fact; it only interprets unknowns.
    if (deterministic.outcome !== 'unknown' && result.outcome !== deterministic.outcome) {
      throw new InvalidRelevanceResultError(`model changed deterministic outcome: ${result.criterionId}`);
    }
    return deterministic.outcome === 'unknown' ? result : deterministic;
  });
  return { decision: decideMatch([...criteria], merged), results: merged, summary: model.summary.trim(), modelUsed: true };
}

export const assessMatch = orchestrateMatching;
