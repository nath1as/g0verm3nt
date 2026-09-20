# Luna calibration and harder repair tasks

Status: two development calibrations have executed; see [original result](luna-calibration-result.md) and [v2 result](luna-calibration-v2-result.md). Each returned five verified tasks and one failure, so the frozen rule classifies both as too easy. No workflow comparison or learning stage was launched. Both corpora were qualified and frozen before provider execution and are not revised from their outcomes.

The original corpus is closed after its too-easy result. The new development corpus is versioned separately: `bun src/experiments/luna-calibration.ts <new-state-directory> --qualify --v2`, then `bun src/experiments/luna-calibration.ts <same-state-directory> --run --v2`. Qualification independently runs public and hidden suites against the reference and original source inside the actual sandbox. An existing launch manifest prevents replay. Frozen source snapshots and durable SQLite provider/evaluation records remain in the state directory.

Concrete calibration limits: six direct provider attempts maximum, 120 seconds per attempt, observed ceilings of 30,000 input and 8,000 output tokens per attempt, and the existing 32 KiB replacement-file / 48 KiB patch-artifact bounds. Token ceilings are checked after completion and stop subsequent scheduling; they are not provider-enforced billing caps. Infrastructure, unavailable model, or unknown usage stops the schedule. Malformed output counts as a format failure and makes calibration inconclusive rather than being called a reasoning failure. The ordinary hidden evaluator retains the existing sandbox's ten-second wall limit.

## Executor

Use `gpt-5.6-luna` with explicit `model_reasoning_effort = "low"` for every worker attempt. The local Codex model catalogue lists this model and effort. OpenAI describes Luna as the cost-sensitive member of the family, roughly corresponding to the former nano tier: https://developers.openai.com/api/docs/models/gpt-5.6-luna . Catalogue presence establishes discoverability, not a successful authenticated call. Do not claim it is empirically the weakest without measurement.

Pin effort in the adapter and configuration fingerprint. The current adapter does not expose reasoning effort; setting model alone would leave Luna at the catalogue's medium default. Treat the first calibration attempt as the real availability check; preserve failure and stop if unsupported rather than silently substituting another model. API list prices do not establish local Codex subscription billing.

## Version-two calibration corpus

The version-two corpus kept the six behavior classes but introduced two additional, independent defects per component outside the first corpus's public examples: parser CR/closed-field handling, queue cancellation/refill, merge representation/deletion, cache ordering/deletion, replay cursor/order, and allocator accounting/clear. Its task IDs and frozen source hashes are new. It qualified, then again produced five direct successes. It is closed development data; do not use it for workflow comparison.

## Original six calibration tasks

Each task is a small TypeScript component with one editable implementation and read-only helpers/public tests, roughly 100–250 implementation lines. Difficulty comes from interacting specified requirements, not omitted contracts. Avoid artificial broken infrastructure, external services, sleeps, or deliberately misleading diagnostics. Use fake clocks and controlled promises for deterministic tests.

| Task | Required behavior and likely bugs | Independent checks |
| --- | --- | --- |
| Streaming delimited-record parser | Preserve quoted fields and doubled quotes across arbitrary chunk boundaries; handle CRLF split across chunks; report malformed final input | Same parse for every split of a short input; chunked versus whole-input equality; embedded delimiters/newlines; empty final field; exact error policy |
| LRU cache with expiry | Expired entries never return; successful reads update recency; replacements reset expiry; capacity evicts the least-recent live entry; cached undefined differs from a miss | Fake-clock boundary cases; capacity zero; replacement without duplicate nodes; interleaved expiry and eviction; seeded traces against a simple independent reference |
| Bounded asynchronous work queue | Respect concurrency; preserve result order; cancellation prevents new starts; drain already-started work; propagate specified failure without unhandled rejections | Controlled-promise schedules with no wall-clock race; reject/cancel permutations; peak concurrency; no post-cancel starts; declared terminal behavior |
| Layered configuration merge | Recursive object merge; explicit null deletes; arrays replace; precedence is exact; inputs are immutable | Nested deletion and override interactions; type changes; null versus missing; aliasing checks; agreement with a separately authored recursive reference |
| Event replay with duplicate delivery | Ignore an identical repeated event; reject conflicting reuse of an event ID; preserve exact checkpoint cursor and state; resumed replay equals uninterrupted replay | Duplicates before/after checkpoint; conflicting payload; invalid ordering under explicit policy; snapshots at every prefix; final-state equivalence |
| Interval reservation allocator | Half-open intervals; deterministic earliest-fit selection; coalescing free ranges; cancelling a reservation restores precisely its range | Adjacent endpoints; fragmented free space; repeated cancellation policy; capacity conservation; generated traces checked against a discrete occupancy oracle |

These are proposed suitable tasks, not proven hard tasks for Luna. The corpus includes local repairs and stateful multi-invariant repairs so workflow usefulness can vary naturally. Source size is a guideline, not a difficulty score.

## Calibration before learning

First run direct repair once on each of the six tasks: six worker attempts maximum. A useful initial signal is two to four verified successes out of six; this is a practical calibration target, not a confidence interval. If all or almost all pass/fail, report that observation and revise difficulty using calibration data only. Do not call those tasks held-out afterward or claim success by selecting convenient individual outcomes.

If difficulty is suitable, run public-feedback repair and explicit invariant-decomposition workflows on the same development tasks. Decomposition must produce a retained intermediate artifact consumed by the repair call; a sentence asking the worker to think harder is not a separate implemented workflow. Keep worker model and reasoning effort identical across workflows. Distinguish workflow effects from merely spending additional attempts with an equal-attempt retry control before a benefit claim.

Require actual complementary outcomes across tasks, not just different total token counts for identical successful paths. If one fixed workflow dominates, keep it and stop the routing experiment. Only after discovery supports a route, freeze its generator/feature grammar, authored control and best fixed control; assess on newly authored or independently selected tasks with different bug mechanisms. Never use calibration or discovery results as held-out evidence.

## Evaluation and scope

Qualify every public/hidden oracle against a trusted correct implementation and original buggy implementation before model execution. Test behavior with hidden cases derived from the published contract; hidden failures never become retry feedback. All candidate execution stays in the existing isolated evaluator. The new tasks need a larger output allowance than one-line repairs: freeze the replacement-byte and output-token limits from qualified source sizes before launch, rather than carrying over the old 2,000-output-token ceiling blindly.

Persist all attempts, failures, public diagnostics, final hidden evaluation, exact model/effort, and observed usage. Report calibration and development costs separately from assessment and reuse. Initial authorization/schedule is a six-attempt calibration stage; later experiments need a frozen concrete scope and stop policy. This document is a model/task selection proposal, not an executable experiment manifest.
