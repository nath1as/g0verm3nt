# Semantic decision runtime — offline slice

Status: implemented and offline-tested on 2026-09-21. It produces a durable action recommendation, not an execution grant. No model weights, external inference, Docker downloads or trained selectors were used.

## Implemented behavior

[`src/core/semantic-decision.ts`](../../src/core/semantic-decision.ts) implements the pure portion of the [decision contract](semantic-decision-contract.md):

- Exact manifest fingerprints, declared task/language/environment coverage and required source checks. Only `projection/evidence@1` is installed; it includes the question, ordered options and required evidence in the text supplied to the pinned tokenizer. Unsupported projections/tokenizers and oversized inputs cannot reach inference.
- Strict probability-map decoding without repairing invalid distributions. Finite values, complete option identities and the manifest's normalization tolerance are required. Ties follow frozen option order.
- Calibration identity, metadata and expiry checks, plus an explicit `temperature@1` transform that retains the original distribution. Every estimator dependency participates in its fingerprint. Evidence transfer is unsupported and therefore fails closed. Matching metadata does not establish empirical calibration quality.
- A deterministic expected-loss selector with explicit units, action-benefit references, independent eligibility references, action token allowances and fixed fallback. Missing utility evidence excludes that action from expected-loss scoring. Ineligible or unaffordable fallback produces a stop. Policy order resolves ties.
- Disjoint training, calibration, selection and assessment lineage checks. This checks supplied lineage labels; dataset importers must still establish actual lineage and partition provenance.

[`src/runtime/semantic-decision.ts`](../../src/runtime/semantic-decision.ts) exposes `runSemanticDecision(store, gateway, request, signal)`. It snapshots the caller's data, records the complete manifest, calibration, input, policy, eligibility, limits and applicability result before provider dispatch, and uses the existing durable provider-attempt ledger. Terminal observation, selection, exact policy hash, catalogue reference and remaining observed-token threshold are retained in SQLite events and the run outcome. No database schema migration is needed; the existing event payloads hold these records.

Unsupported input, unavailable calibration or insufficient inference allowance skips the provider and considers only the declared fallback. Missing/malformed probability output remains charged and observable. Unknown/inconsistent usage, an inference allowance overshoot, unexpected model/tool activity, cancellation and uncertain completion stop selection. Calibration is checked again after inference; a newly expired artifact permits only fallback. Usage is charged before action planning, so inference can leave no affordable action.

The caller supplies an installed trusted tokenizer. The tests use a named character-counting fake, not an approximation presented as a real model tokenizer. The gateway is also a trusted adapter boundary; model output is untrusted. Token allowances are prospective planning and retrospective spend thresholds, not hard provider billing caps. The timeout stops waiting and marks the effect indeterminate even if an adapter ignores cancellation; it cannot prove that a remote provider stopped work or billing.

The runner never dispatches the recommended action. Eligibility and calibration references are retained claims from the controller, not checked registry receipts. Production wiring must resolve and validate those artifacts before relying on them. A succeeded decision run means that a decision (including a permitted stop) was recorded; it is not task success, calibration validation or graph admission.

## Verification

`bun run check` passes: 168 tests, one opt-in isolation skip, 903 assertions, typecheck and lint. Twelve new tests exercise the pure core and SQLite-backed runner. They include malformed distributions, altered calibration dependencies, unsupported inputs, affordable and unaffordable fallbacks, unknown usage, post-inference depletion, cancellation, a noncooperating timed-out fake adapter, mutation of caller-owned configuration during inference and calibration expiry during inference.

The persistence test closes and reopens the real SQLite store, reads the original decision and refuses another invocation with the same run identity before provider dispatch. Indeterminate attempts are retained and re-entry is rejected. This is decision-run replay prevention, not qualification of action dispatch or arbitrary crash recovery at every write boundary.

Focused reproduction:

```sh
bun test tests/core/semantic-decision.test.ts tests/semantic-decision-runtime.test.ts
```

The runtime bounds serialized planned records to 1 MiB and projected prompts/decoded responses to 64 KiB. It supports at most 20 declared options. These are explicit first-slice limits, not claims about a model's general capacity. Provider transport must bound raw acquisition independently; rejecting an oversized returned string does not prevent its allocation inside a provider adapter.

## Next executable slice

Register the applicability/estimator/selector as exact catalogue capabilities, resolve calibration and eligibility artifacts through trusted admission, and translate the selected tag into the existing finite graph grammar. Before any action dispatch, recheck current admission and reserve the action's enforceable runtime allocation atomically. Exercise suspension, stale snapshots, competing reservations and crash-after-dispatch through that real path. Do not route directly from this recommendation to a provider call.

Then qualify a real tokenizer/estimator adapter only when justified by the repository comparison. No change is made to that frozen comparison, and no trained selector or measured-benefit claim follows from this slice.
