# Lean execution plan

Status: active roadmap

Audit correction (2026-09-20): follow [implementation-audit.md](implementation-audit.md) for current completion status and the immediate P0–P4 delivery order. The bounded normalization fixture now demonstrates Gate A; existing live M3/M4 reports still do not satisfy a coding-improvement claim or Gate C. Historical implementation notes below describe components, not acceptance-gate completion.

This is the delivery roadmap for the formal authority in [`plan.md`](../plan.md) and [`computational-shard.md`](../computational-shard.md). It orders the same requirements around stop/go decisions so the project can establish its central mechanism before funding a general agent runtime.

## Economic objective

The first claim worth paying to test is:

> A child, using declared finite evidence, can authorize a typed relation revision of its governor; a later pinned run uses that revision; restart never silently repeats work.

This is a mechanism claim. It is not a claim that adaptation improves coding outcomes. M3 and M4 exist to measure that later claim only after the mechanism works.

## Current baseline

M0 is complete. The implemented M1 foundation includes command identity and receipts, a local writer and active-run projection, a checked serial graph fragment (`id`, exact `call`, `wire`, `seq`, `route`, `guard`, bounded `retry`), named contracts, and serializable in-memory frames. The persisted graph/frame, outbox, recovery, run tree, run/execution relation, and inclusive operation-reservation ledger now exist. Actual provider usage charges, shared composition state, the normalization fixture, and the mutation path do not yet exist.

## Operating policy

- One implementation lead owns a dependency chain. Do not parallel-edit `src/core`, `src/runtime`, or `src/storage`.
- Use short read-only scouts only to inventory files, failure windows, or test gaps. Use an adversarial reviewer only after a coherent slice is green.
- Every slice has one task record, one observable invariant, targeted checks while editing, one full `bun run check` at completion, and a runnable demonstration.
- Freeze definitions, manifests, evaluators, evidence policy, and task splits before collecting the result that relies on them.
- A failed gate repairs only the measured defect or ends the experiment. It does not expand scope to make a demonstration pass.

## Phase 1 — Finish the cheap semantic boundary

### 1. Bounded retry semantics

Implemented: `retry(k, graph, restorationWitness)` is the final sequential operator. Its closed witness binds an exact input precondition, finite witness and graph caps, retryable declared failures, same-input restoration, required idempotency, and a repeated-effect ceiling. The reference interpreter uses typed domain-failure results only; host exceptions are not retried. Frames retain a one-based attempt identity, completed attempt IDs, and unique operation IDs while restoring only the retry body's original input. Reject recursive calls and `par`.

Gate: bounded generated sequential graphs agree with the reference interpreter; retry never exceeds its attempt cap and cannot run without its witness.

### 2. Conformance and manifest model

Implemented: immutable graph-definition records snapshot their checked graph and exact catalogue manifest in memory. Registration uses immutable registry updates and exact graph references; it has no mutable graph head. The frame-stepper driver and reference interpreter agree on a bounded-retry sequence. No SQLite schema changes occur until the durable transaction shape is fixed.

Gate: every supported leaf resolves through its exact recorded reference; unsupported constructors and incompatible schemas remain rejected.

## Phase 2 — Durable execution kernel

### 3. M2-A: one atomic execution transaction

Started: canonical JSON and SHA-256 content hashes now back insert-only graph definition/catalogue records. Versioned additive SQLite migrations persist pinned graph executions, frames, operations, outbox rows, and operation events. Frame reads verify supported encoding, canonical hashes, exact manifest/catalogue references, rebuild a runnable graph definition from strict contract/schema syntax, decode exact frame state from pinned graph fragments, and bind an awaiting frame to its operation and outbox records. Rebuilding recalculates graph semantics rather than trusting the stored checked cache. Frames have a versioned envelope and compare-and-swap revision: planning commits the advanced frame, operation intent, outbox payload, and event in one transaction; a separate committed transition marks the operation/outbox dispatched before an external boundary; observation commits the observed operation and resulting frame only from the expected revision. An explicit indeterminate transition preserves ambiguity without claiming success. Every writable store now holds a Linux flock lock for its lifetime; a second process fails instead of advancing the workspace. Explicit reconciliation now classifies planned work and preserves dispatched ambiguity as indeterminate. An explicit adapter lookup may settle only indeterminate work when it returns a matching observation with immutable adapter attribution; an unknown lookup changes nothing. Automatic dispatch and replay remain disabled. A real SQLite restart test now preserves a retryable failure's restoration input, witness, completed attempt ID, used operation ID, and next attempt ordinal before it plans the next operation; frame inspection cross-checks those retry histories against the exact persisted operation set.

The OS-backed writer lock is verified before recovery is enabled. Model operation states as planned, dispatched, observed, and indeterminate; never infer external success from a missing response.

Gate: real SQLite restart/fault tests cover intent creation, dispatch mark, response receipt, and continuation advancement. A second writer fails to acquire ownership. Missing or incompatible definitions block resumption with an attributable error.

### 4. M2-B: recovery and retry

On startup, reconcile every persisted operation before resuming frames. Dispatch only committed outbox rows. Persist retry attempt chains and restoration witnesses. Read-only replay must inspect frames and operations without dispatching them.

Gate: restart cannot silently repeat an operation; unknown remains distinct from success and zero usage; retry cap, attempt IDs, and restoration data survive restart.

### 5. M2-C: only the ownership and budget required by the fixture

In progress: durable parent-child ownership records stable spawn order and blocks a parent from settling while an owned child is active. Fresh graph intents attach atomically to one live run. Immutable operation allocations now reserve one operation per admitted run-bound graph operation, retain that reservation across dispatch and indeterminate recovery, and enforce inclusive capacity through ownership ancestors. Join and failure propagation plus one durable runnable-operation permit per ownership tree are now implemented. Unique operation usage charges now have explicit known or unknown state, one operation identity, later unknown-to-known settlement, and inclusive ancestor projections. Fixed fixture limits now reject the third direct child and ownership beyond four levels atomically. Next begin the M2-D revision and dependency foundation. Do not generalize beyond the fixture limits.

Gate: a parent cannot succeed before owned children close; an unobserved child failure propagates in spawn order; controlled concurrent children cannot overspend; a parent waiting on a child releases the single runnable-operation permit.

### 6. M2-D: revision and direct dependency foundation

Graph heads with expected-version commits are durable and restartable. Immutable proposals and checked receipts now bind a candidate to an exact base head and stale competing proposals remain explicit. Proposals now carry unique direct dependency links with deterministic forward and reverse lookup. Dependency status is durable and separate from proposal lifecycle; idempotent active, suspended, and retired transitions update a status fingerprint and suspend pending proposals that directly depend on revoked support. Receipts bind the checked dependency fingerprint, so a later status change makes commit fail closed across restart. A bounded composition checkpoint now stores exact references and cursor metadata with a 4 KiB canonical root-descriptor and 32-reference/16 KiB view budget. Full records remain queryable from their authoritative tables. Deterministic bounded views now report omitted records and continuation cursors explicitly. The minimal authoritative composition relation registry and deterministic lookup now back checkpoint references. The normalization fixture now defines one exact catalogue, authored canonicalization contract, baseline/revised checked graph references, a deterministic evaluator, and complete-audit evidence admission. Evidence records are durable and proposal-linked; CLI inspection covers heads, proposals, dependencies, checkpoints, and relations. An offline M3 fixed-comparison manifest is also frozen, and its provider-neutral runner records deterministic variant outcomes, latency, call counts, usage state, errors, and response fingerprints under the frozen budgets. An offline M4 policy scaffold now separates held-out observations from discovery and applies fixed benefit and cost thresholds with an explicit fallback. A deterministic assessment runner now assembles sorted cohorts, applies the policy only to held-out observations, and fingerprints the decision artifact. Next connect persisted evidence to the complete normalization demonstration, then add durable coding cohorts and the production provider. The checkpoint holds references and cursor metadata; full records remain queryable.

Gate: competing commits yield one winner; stale, invalid, or revoked support blocks/suspends the relation; a fresh session restores the exact head and direct dependencies. Enforce the 4 KiB root and 16 KiB/32-record view budgets.

## Phase 3 — M2a: finite mutation mechanism

### 7. Freeze and execute the normalization fixture

Register two deterministic capabilities, a baseline normalization graph, an authored classifier/route revision, an exhaustive evaluator, and a finite evidence policy. A child produces one typed proposal to its governor. The governor validates authority, exact base head, structural graph, evidence, dependencies, and budget before atomic commit.

Expose baseline/revised execution, manifest, frame, operation, proposal, evidence, graph head, and suspension through the CLI.

Gate A — mechanism decision:

- Baseline and revised graphs preserve the declared fixture contract.
- A valid child proposal changes only a subsequent pinned run.
- Prior runs retain their original manifest and graph.
- Invalid preconditions, stale receipts, and revoked evidence block or suspend the relation.
- Restart at intent, response, and revision boundaries does not silently duplicate an operation.

If Gate A fails, repair the failed mechanism or stop. Do not begin M3.

## Phase 4 — M3: one useful, fixed coding experiment

### 8. Provider and persisted agent leaf

Choose one production provider after a bounded compatibility spike. Build one persisted agent leaf with a pinned model/configuration, complete-argument typed tools, call/result pairing, cancellation, known/unknown usage, and recorded error fixtures.

### 9. Isolated TypeScript refactor vertical

Build one disposable Linux workspace/container profile, a narrowly typed read/search/patch/test tool set, and an evaluator pinned outside the editable workspace. Produce a patch artifact and rerun the evaluator in a fresh workspace.

### 10. Fixed comparison

Run one baseline and at most two one-variable fixed alternatives. Freeze task split, evaluator, budget, manifests, and comparison rule before results. Report success, cost, latency, context, retries, and terminal reasons. Freeze the strongest eligible fixed configuration.

Gate B — useful-task decision: a reproducible comparison exists. An inconclusive or negative result is valid; retain the fixed harness and do not claim benefit.

## Phase 5 — M4: adaptive coding assessment

### 11. Evidence and promotion policy

Extend the M2a proposal path to versioned coding cohorts, development/held-out splits, evaluation-only runs, consistency policy, benefit policy, stale revalidation, counterevidence suspension, and checked fallback revisions.

### 12. One constrained adaptive route

Permit a model to propose only a relation among registered M3 variants using the existing graph and patch grammar. Route on registered metadata or a registered classifier; define the fallback for unknown, failure, unsupported scope, and budget exhaustion. Compare the accepted route against the frozen fixed M3 configuration and include discovery/evaluation/failed-candidate cost.

Gate C — adaptive-value decision: report supported improvement, no eligible candidate, or admissible but unhelpful/inconclusive. Retain the fixed harness unless the held-out policy supports promotion.

## Conditional follow-ups

Do not fund these merely because they are described in the formal plan:

- `par`, generic retry variants, broad theorem/refinement support, general migrations, and full composition indexing.
- TUI, second provider, plugins, continuous shard/socket runtime (M6), packaging/release hardening (M7), and M5 recursive composer mutation.

M5 receives a separate hypothesis and budget only after Gate C. M6 and M7 require practical value beyond the research report.

## Lowest-token agent workflow

| Work | Default model and effort | Shape |
|---|---|---|
| Slice planning, integration, implementation, tests | `gpt-5.6-terra`, medium | One lead |
| File map, test-gap scan, narrow diagnosis | `gpt-5.6-luna`, low | One read-only scout |
| Durability, recovery, evidence-policy review | `gpt-5.6-sol`, high | One read-only reviewer |
| Rare unresolved formal-design decision | `gpt-5.6-terra` or `gpt-5.6-sol`, high | Lead plus one reviewer |

Use at most two agents at a decision gate. Give each a fixed question and a short output contract: inspected files, findings, missing acceptance case, and recommended next test. Never ask several agents to implement overlapping runtime/storage changes. Subagents duplicate context and tool work, so they are economical only for independent evidence gathering or adversarial review.

Recommended review points are: semantic conformance before Phase 2, recovery-failure matrix before M2-A, sandbox/provider interface before M3, and experiment-design audit before M4. Keep the main lead through each related chain; start a fresh context at milestone boundaries using the completed task records.
