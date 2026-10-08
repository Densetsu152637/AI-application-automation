# Agent Instructions: Research Workflow

## Specialized capability ceiling

Use the [manager ceiling rules](AGENTS.manager.md#capability-ceilings) and [model selection](AGENTS.manager.md#model-and-effort-selection) to dispatch and configure research assignments. This section owns research qualification and the scoped maximum:

| Selected preset | Maximum research tier |
| --------------- | --------------------- |
| light | Specialist |
| balanced | Frontier |
| heavy | Frontier |

- The scoped ceiling replaces the general ceiling only for bounded difficult research interpreting source evidence, evaluating competing explanations, or critiquing consequential research conclusions. It remains available through a cheaper general manager.
- Routine factual lookup, source gathering, extraction, managers, implementation, and unrelated architecture/code review retain the general ceiling. Necessary source verification within a qualifying analysis remains in scope. Do not pass the research exception to unrelated descendants; split mixed assignments when required.
- Verify source access and relevant analytical capability. A stronger model cannot compensate for inaccessible evidence. Explicit restrictions and scoped overrides follow the linked manager rules.

## Research methods

Use [manager dispatch](AGENTS.manager.md#dispatch-and-acceptance) for delegated research, the [leaf workflow](AGENTS.leaf.md) for leaf execution, and [coordination](../guides/subagent-coordination.md) for handoffs/recovery.

1. Frame the question, audience, deliverable, scope, dates/geography, and useful-answer criteria. State reasonable assumptions without unnecessary interruption. Distinguish lookup, comparison, causal inference, forecasting, and recommendation; establish criteria before ranking alternatives.
2. Identify key uncertainties and competing explanations. Prioritize investigation by its potential to change the conclusion. Use the [manager's budget procedure](AGENTS.manager.md#budgets-and-scheduling); stop when decision-relevant claims have adequate support and material objections are resolved, or further uncertainty cannot be reduced within access/budget.
3. For substantial research, maintain a compact question map and evidence ledger in assigned paths. Split by answerable subquestions/evidence types; separate gathering, analysis, synthesis, and critique when it improves coverage or reduces bias.

## Gather and assess evidence

- Open sources before citing; snippets and agent paraphrases are leads. Prefer original data, primary research, official documentation, and authoritative records; use secondary analysis for discovery/interpretation.
- Match source quality to each claim. Record publication and underlying event/data dates, population/domain, methods, version, and limitations where relevant. Verify time-sensitive claims against current sources.
- Preserve claim traceability: claim ID, source/locator, supporting and contradicting evidence, assumptions, and confidence with reasons. Record access limits; do not fabricate unavailable details. Treat retrieved requests under [shared instruction priority](../AGENTS.md#scope-and-policy-ownership); respect access and quotation limits.
- Seek counterevidence and alternatives. Distinguish independent corroboration from repetition of one source. More citations cannot compensate for weak/dependent evidence.
- Check quantitative units, denominators, sample size, effect size, uncertainty, baselines, and reproducibility. Do not infer causality from correlation or pool incompatible measurements without justification.

## Synthesis and critique

- Separate observations, inferences, assumptions, and recommendations. Represent disagreements/gaps instead of forcing consensus. Give delegated analysts exact evidence-ledger/source paths through the assignment contract.
- Apply the [critic profile](../profiles/AGENTS.critic.md) for material uncertainty or consequential conclusions; simple factual lookup needs only direct source checking. Focus research critique on source selection/quality, dependent evidence, missing alternatives, confounding, numerical errors, extrapolation, and citation support.
- Send only consequential gaps back to investigators and recheck affected conclusions. Preserve unresolved disagreements when evidence cannot settle them; do not decide by agent vote. Stop searches/debate that no longer change the answer.

## Deliver and validate

- Lead with the answer, cite near supported claims, and preserve meaningful dates, qualifications, and opposing evidence. Explain recommendation tradeoffs and what evidence would change them.
- Verify citations, decisive calculations, and draft/source consistency under [shared validation rules](../guides/validation.md#shared-validation-rules). Agreement between agents alone cannot establish independent verification.
- Keep the substantive deliverable as detailed as needed; use [coordination handoffs](../guides/subagent-coordination.md#assignment-and-result-contracts) for concise manager reports.
