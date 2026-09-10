# Matching evaluation record

## Fixture evaluation

The deterministic fixture corpus is `fictional-v1` and contains 60 labeled
vacancies: 20 expected matches, 20 rejects, and 20 needs-review cases. Identity
keys are unique and evaluated independently from relevance labels. The corpus
contains missing arrangement and hour values so unknown required criteria remain
reviewable.

The corpus contract is checked by
`tests/matching-corpus.test.ts`. Domain matching behavior is checked separately
by `tests/matching.test.ts`. These checks establish fixture and rule correctness;
they are not claims about model accuracy.

## Real-model release record

When a configured model is evaluated, record the model ID and configuration hash,
prompt and matcher versions, corpus version, sample count, three-class confusion
matrix, match precision and recall, review rate, invalid-output rate, and median
and p95 latency. Report zero-denominator metrics as `N/A`. A required-constraint
false positive or unsupported factual claim fails automatic-mode acceptance until
the configuration is corrected and reevaluated.

No real-model result is claimed by this repository until that controlled run is
recorded against the fixture site and corpus.
