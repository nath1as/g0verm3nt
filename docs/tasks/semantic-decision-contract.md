# Semantic decision contract

Status: the offline decision core and durable recommendation runner are implemented and tested; see the [runtime slice](semantic-decision-runtime.md). Production graph registration, atomic action dispatch, calibration-evidence admission and trained selectors remain unimplemented.

This contract refines [semantic classification in the plan](../../plan.md#semantic-classification-and-uncertainty-experiments). It uses ordinary versioned shard capabilities and the existing finite route grammar. It introduces no new execution primitive, authority grant or admission shortcut.

## Applicability, prediction and action

Represent the decision as three separately versioned capabilities: check applicability, estimate a semantic observation, and select an action under a policy. Preserve the original task and its source references alongside the bounded estimator input. Only the selected finite action tag reaches a graph route; probability arithmetic and domain interpretation belong inside registered capabilities, not routing callbacks.

The applicability capability runs before model inference. Its manifest declares supported task families, natural languages and repository languages where relevant, required evidence fields, environment profile, input-projection version, tokenizer and token limits, and allowed question schemas and option sets. Check explicit metadata first. An inferred language or task family is itself an observation with provenance and declared uncertainty, not a proof of scope. Ambiguous or unsupported metadata returns `Unknown`. Applicability checks establish declared coverage conditions, not absence of all distribution shift.

Count tokens after applying the exact projection and including the question/options. Missing required evidence, ambiguous scope, unsupported schemas, or exceeded budgets must prevent inference. Do not silently truncate the task or squeeze option descriptions until their distinctions disappear. A summarizer or hierarchical selector is a different versioned dependency with its own evidence and cost. Preserve source references so a later evaluator can inspect what the classifier actually received.

The conceptual immutable records are:

```text
DecisionManifest = {
  estimatorRef, modelArtifactHash, tokenizerRef,
  questionSchemaRef, orderedOptionsHash, inputProjectionRef,
  applicabilityPolicyRef, calibrationRef | Uncalibrated
}

SemanticObservation = {
  manifestHash, inputRef, projectedInputHash, sourceRefs,
  applicabilityResultRef,
  result: Estimate { tag, rawProbabilities, calibratedProbabilities? }
        | Unknown { reason },
  inferenceRunRef | NotDispatched
}

ActionDecision = {
  observationRef, actionPolicyRef, catalogueManifestHash,
  eligibilityEvidenceRefs, allocationSnapshotRef,
  selectedActionRef | Stop { reason },
  reason, expectedLossEstimate | Unavailable,
  usageRefs
}
```

These are required logical fields, not a new serialized runtime format. Concrete codecs, size limits and database migrations require their own implementation slice. References resolve to immutable artifacts; hashes alone cannot restore inputs, policies or calibration data. Missing probabilities and unknown usage must remain explicit rather than becoming zero.

Validate model responses at the adapter boundary: declared tags only, exactly the declared option identities, finite values in `[0,1]`, and normalized distributions under a frozen numeric tolerance. Reject malformed output; do not silently renormalize it. The question schema defines how tags are derived and how ties are handled. Typed numeric output establishes structural validity only. Estimator failure, malformed output and unsupported applicability produce distinct `Unknown` reasons and retain attempted-operation accounting. Cancellation and indeterminate external effects retain the runtime's terminal/reconciliation semantics; they must not dispatch a fallback implicitly.

## Calibration as a dependency

A calibration artifact binds the full estimator manifest excluding `calibrationRef`, the target event/label semantics, calibration method/version and parameters, dataset manifest, task lineage, label/evaluator provenance, and applicable strata. Record raw and calibrated distributions separately. A schema, option ordering or membership, tokenizer, model, input projection, or applicability-policy change creates a new manifest and requires new calibration evidence or an explicit evidence-transfer certificate. Do not reuse a temperature merely because the model name is unchanged.

Separate training/discovery, calibration fitting, policy selection and final assessment by task lineage. Related traces from the same issue stay in one partition. Fit calibration on its assigned partition, select thresholds/actions on development data, then freeze all artifacts before assessment. If available data cannot support those partitions, report insufficient evidence and retain the fixed policy; do not consume reserved assessment tasks to tune the selector.

Report proper scoring metrics such as Brier score or log loss alongside reliability summaries, calibration sample counts and uncertainty, per supported stratum. Report decision error versus coverage when the estimator abstains. A single pooled calibration error does not establish reliability for every class or task family. Proper-scoring-rule training and a numeric probability output do not themselves establish calibration on deployment inputs.

`Uncalibrated` outputs may be recorded in an explicitly declared evaluation experiment. A production policy requiring probabilities must reject absent, stale or incompatible calibration and take its fixed fallback. Calibration is empirical evidence about predictions, not a semantic proof or an admission receipt.

## Budget-aware action policy

The action policy binds a finite list of exact eligible capability references, a fixed fallback, loss-table/version, cost units, any thresholds and tie-breaking, and explicit behavior for missing estimates. Predicted states describe task conditions; actions describe what the workflow will do. A high probability of `ContextMissing` does not by itself choose retrieval, a new session or termination.

First filter actions by independently checked contracts, active admission, scope and runtime grants. Then filter by the remaining enforceable allocation, including dispatch, verification and cleanup obligations. Among feasible actions, a frozen policy may minimize expected loss `sum_s p(s) * L(action, s) + cost(action)` only when loss and cost have declared compatible units and supported estimates. Otherwise use a declared constrained or lexicographic policy, or the fixed fallback; never add dollars, tokens, latency and failure probabilities without an explicit conversion policy.

A classifier probability is not an action-success probability. Estimating action benefit requires evidence for those actions in the corresponding states. Missing counterfactual outcomes are unknown, not failures. Do not select an action on an unsupported benefit estimate. The shared final evaluator remains independent of the selected action.

Reserve/check the estimator's own allocation before inference and recheck available allocation after its observed usage. Immediately before dispatch, the runtime revalidates the selected capability and reserves its allocation atomically. The recorded snapshot and action decision grant no execution authority. A stale selection is rejected without silently switching capability versions. Fallback must also be compatible, authorized and affordable; otherwise return an explicit stop. Unknown usage follows the existing unresolved-liability policy. Retrospective provider token counts remain observed spend thresholds, not guaranteed billing caps.

Persist the applicability outcome and inference dispatch identity before external inference; retain the terminal observation and action decision before action dispatch through the existing operation ledger. Recovery must reconcile uncertain inference/action operations and never replay them from a confidence record. Preserve estimator errors and unused decisions for total-cost accounting.

## Learning a reusable selector

Keep the current [repository comparison](repository-benchmark-plan.md) unchanged. Only complementary, independently verified workflow outcomes justify a subsequent selector experiment. Uniformly beneficial behavior becomes the fixed workflow; uniformly successful synthetic tasks do not supply evidence for routing.

The child may propose a selector trained from development evidence, with features available at the actual decision point. Exclude issue identity shortcuts, future observations, gold patches, hidden tests and grader-only labels from classifier inputs. Labels may use controller-held development outcomes, but privileged artifacts never enter worker inputs or the assessment feature pipeline. Label provenance must distinguish measured paired outcomes from teacher preferences and missing counterfactuals.

Freeze a comparison among the strongest eligible fixed workflow, a deterministic rule, a small conventional classifier, and optionally a Laya-backed selector. Match task sets, permitted actions and resource policies. Compare end-to-end verified outcomes and resource use, not classifier accuracy alone. Bound candidate count and training/search spend in advance; include failed candidates, calibration, labeling, input projection, startup, model residency and inference costs. Select the candidate on development data and assess only after freezing it. Keep per-input decisions and fallback frequency.

Laya is a candidate backend, not a dependency. Its reported need for domain calibration and specialization motivates these checks; its benchmark results are not Government evidence. Its model card also distinguishes warm inference from model-loading costs. Pin source, weights and runtime only when a separately budgeted experiment warrants downloading them. [Laya model card](https://huggingface.co/convaiinnovations/laya), [maintainer description](https://laya.convaiinnovations.com/).

Production reuse still requires contract admission and a separate measured-benefit decision. A child-originated proposal binds the estimator, calibration, projection, action policy and exact action catalogue as dependencies. Suspension or incompatible revision invalidates dependent decisions/admissions through the normal governance path. Report acquisition cost and recurring cost separately; claim break-even only with measured positive recurring savings at the declared quality constraint and workload.

## Acceptance cases for the implementation slice

| Case | Required observation |
| --- | --- |
| Confident estimate for unsupported language/task | Applicability returns `Unknown`; estimator is never dispatched. |
| Required source missing or projected context too long | Explicit reason; no hidden truncation or inference. |
| Malformed distribution, undeclared option, NaN or infinity | Adapter rejects it; attempted usage is retained; compatible fallback only. |
| Question, options, model or projection changes | Old calibration cannot satisfy the new manifest without validated transfer evidence. |
| Calibration absent or expired under its policy | Probability-dependent production choice is unavailable. |
| Same observation, different remaining allocation | Policy selects only an affordable eligible action or stops. |
| Very confident classifier proposes a restricted fast path | Independent precondition obligation still applies; confidence cannot discharge it. |
| No benefit estimate or incompatible cost units | Frozen fallback/constrained policy; no invented expected utility. |
| Inference consumes the action's remaining budget | Post-inference allocation check prevents action dispatch. |
| Fallback unavailable, suspended or unaffordable | Explicit stop; no implicit stronger executor. |
| Capability or allocation changes between decision and dispatch | Atomic runtime recheck rejects stale dispatch. |
| Crash after inference/action dispatch | Reconcile the existing operation; never replay from the saved decision. |
| Related issue traces cross fitting/assessment partitions | Experiment qualification fails before dispatch. |
| Classifier accuracy rises but workflow quality/cost worsens | Measured-benefit gate rejects promotion. |

The [runtime slice](semantic-decision-runtime.md) tests applicability, distribution validation, exact calibration matching, cost/budget selection, lineage separation, cancellation and durable inference records with fake estimators and real SQLite. Atomic action dispatch, action-crash reconciliation, empirical calibration admission and learned-benefit promotion remain separate gates. Passing these contract tests does not demonstrate learned routing benefit.
