# Implementation audit and recovery plan

Date: 2026-09-20. Authority: plan.md milestone acceptance criteria and computational-shard.md v0.3. This audit supersedes previous completion claims; it does not weaken the formal requirements.

## Assessment

The repository demonstrates a bounded offline normalization mutation and verified coding experiments. General admission, dependency propagation, and adaptive coding promotion remain incomplete. The latest local check passes typecheck, lint, and 141 tests with 660 assertions; one opt-in isolation test was exercised separately on the actual host. Passing these tests establishes their specific assertions, not unimplemented milestone gates.

| Area | Current evidence | Status |
| --- | --- | --- |
| M0 | Fake-provider CLI, receipts, cancellation and restart tests | Working offline slice |
| M1 / M2 | Checked graph operators, persisted frames/outbox, ownership, reservations, writer lock and reconciliation tests | Substantial foundation; integration and admission gaps remain |
| M2-D | Head/proposal/dependency tables and checkpoint/reference APIs | Partial; shared state is not an atomic registry-derived projection |
| M2a | Exhaustive persisted-domain evidence, child revision, restart and revocation demo | Bounded Gate A path demonstrated |
| M3 | Evaluator-first coding runner and one paired development comparison | One bounded negative result; no improvement claim |
| M4 | Policy functions; no candidate survived the verified M3 development cohort | Gate C not attempted |
| M5–M7 | Deferral documents | Unimplemented |

## Historical audit baseline

The findings below record the initial audit. Subsequent repairs and experiments are recorded under Ordered delivery plan; they are not all current defects.

1. **Task success is not evaluated.** src/experiments/m3-runner.ts sets success=true whenever the gateway resolves. It neither compiles nor tests returned code, retains only a short response fingerprint, and does not produce an evaluated patch. Previous live reports therefore establish transport completion only. The manually generated retain-fixed decision is not evidence of coding quality or adaptive value.
2. **The normalization revision is an alias of the baseline.** src/fixtures/normalization.ts constructs both definitions from the same single call. There is no classifier/fast/slow graph or exhaustive finite-domain experiment. Evidence admission checks output/audit consistency without the original input, so it cannot establish preservation or canonical correctness.
3. **Evidence is not securely bound to admission semantics.** createGraphEvidence accepts caller-supplied payloads/fingerprints; commitGraphProposal accepts the normalization/evaluation kind label for normalization-prefixed candidates. It does not validate the payload against candidate, evaluator, manifest, policy and source run. Receipt creation accepts a caller-supplied checked fingerprint; the commit query does not validate that fingerprint. Origin ownership is not checked by proposal creation.
4. **Suspension is incomplete.** Status changes suspend pending direct proposals only. A proposal created after a dependency was suspended can remain pending and obtain a receipt for that status; matching the status fingerprint does not establish active admission. Accepted graph admissions and active runs are not transitively suspended.
5. **Checkpoint APIs do not implement the formal shared projection.** References/cursors are independently writable, not derived atomically from registry events. Root-size checks cover only rootRef, not the whole descriptor. Stored reference count limits also prevent paging a larger registry. Relations lack the required evidence/assurance linkage.
6. **Codex adapter accounting and lifecycle need tests.** The current parser ignores malformed lines, does not require successful terminal events, uses the first completion event, drops cached usage, and can classify missing usage fields as known zeros. It launches before checking an already-aborted signal, inherits the working directory/configuration, has no explicit deadline, and returns no observed internal tool activity. The earlier batch interruption remains undiagnosed. Token usage exists in previously observed JSONL output; billed cost is a separate unknown.
7. **The variants and cohorts are provisional.** Variants currently differ by prompt prefixes, not implemented context-management algorithms. The runner has no persisted agent loop or enforced budget. Observation storage lacks experiment/model/evaluator/run provenance and explicit cost units. M4 does not require matched task sets, reject cross-split reuse, or bind its policy into the assessment fingerprint. Latency must not silently stand in for monetary cost.
8. **Migration compatibility needs an upgrade audit.** Earlier work inserted evidence migrations ahead of existing checkpoint/relation migrations and changed an earlier proposal status constraint. Fresh-database tests do not prove upgrades from databases created by those earlier layouts. Preserve any existing databases and inspect their actual schema before repair; never infer layout solely from the migration count.

## Ordered delivery plan

The [Luna low-reasoning calibration](tasks/luna-calibration-result.md) subsequently ran six harder synthetic repairs: five verified and one cache expiry-boundary failure, using 80,576 observed tokens. This supplies a concrete public-test failure but misses the frozen two-to-four-success calibration band. No learned workflow-selection claim follows. The explicit reasoning setting, larger bounded response allowance, qualified corpus, source snapshots, and six-attempt controller are implemented.

The [central-hypothesis discovery pilot](tasks/central-hypothesis-result.md) ran eight real provider attempts across four new tasks. Direct and feedback workflows both verified all four on their first attempts, costing 115,469 tokens in total. The frozen stop rule found no useful tradeoff, so candidate generation, assessment, coding admission, and reuse were not run. No claim of learned benefit or amortization follows. Public/hidden evaluator separation, durable one-retry workflow, and actual process-bounded isolation are now implemented for this pilot.

Migration repair completed: schema v22 creates any displaced evidence/checkpoint/relation tables and rebuilds the proposal status constraint without renumbering migrations. Upgrade fixtures reconstruct v14, v17, original v18/v19 and v21 layouts; they verify preserved records (including receipts and evidence links), foreign-key enforcement, suspension and reopening. The repair checks foreign keys before committing; failure rolls back v22 and closes the database/lock. Existing unsupported or corrupt layouts are not silently repaired. Full check: 84 tests, 322 assertions, typecheck and lint pass. These are reconstructed historical fixtures, not a claim that every external database has been inspected. Invalid receipt semantics and incomplete provider streams remain open P0 work; trusted admission and the distinct normalization graph remain P1.

Trusted normalization admission now has a narrow v23 path. It requires an exact, succeeded child directly owned by a live governor, revalidates every attached normalization evidence envelope and active dependency, then binds proposal/head/base/candidate, policy, evidence and dependency fingerprints in the receipt. Commit recomputes those bindings and rechecks authority. Historical caller-created receipts remain readable for non-normalization records but cannot commit a normalization revision. This establishes a bounded admission boundary; it does not yet prove that the child executed the candidate graph. The fixture now has a distinct bounded route, though its capabilities are not yet dispatched through the persisted graph runtime.

The finite normalization candidates now execute through the persisted frame/outbox lifecycle under the child run's allocation. Version 2 evidence records the candidate, terminal result and dispatched capability; admission and commit independently require the exact terminal graph execution to be attached to the originating child. A syntactically valid but invented execution is rejected. This is one bounded fixture rather than a general dispatcher, and the shared composition projection/revocation propagation remain open.

The `normalization-demo` CLI command now produces the complete offline path in a fresh state directory: baseline head, owned child evaluation, versioned evidence, trusted receipt, revised head, later pinned revised execution, support revocation and a rejected replacement receipt. Its restart test confirms the committed head and subsequent terminal frame remain readable. The demo leaves a new proposal pending after revocation because receipt admission fails closed; the required shared registry projection remains unimplemented.

Accepted proposal dependencies are now projected onto each head in the same commit transaction. A trusted normalization commit additionally derives a provenance-bearing composition relation from base graph to candidate graph, with its proposal, receipt, policy, evidence and authority references in canonical scope. Suspending a dependency atomically suspends each active dependent head and that derived relation; head-based normalization execution rejects before it can reserve or dispatch an operation. Historical heads remain inspectable, and an explicit later admission is required to make a supported head active again. This is still a bounded normalization projection, not the formal shared composition registry.

Both normalization candidates now execute every case in the declared five-case finite domain through durable frames. The test compares each terminal output against an independent canonical sorter and verifies the route's dispatched capability. A normalization revision now requires one version-3 persisted-domain evidence bundle: all five ordered cases must have distinct, terminal executions owned by the originating child. Version-2 single-case evidence remains readable but cannot admit or commit a new revision. Schema v29 permits that bounded child to own multiple graph executions while the existing inclusive operation allocation caps all five operations.

Schema v25 adds a restartable composition-projection event cursor and a bounded read-only view derived from current heads, pending or suspended proposals, and durable relations. Head commits, dependency status transitions and relation creation write their registry change and projection event in one transaction. The view is available through `inspect composition`; manual checkpoints remain non-authoritative convenience records.

The shared-composition view now enforces its 16 KiB UTF-8 budget as well as its 32-summary count. It returns the largest code-point-ordered prefix that fits with an advancing continuation cursor, and rejects a single oversized summary rather than omitting it silently. This bounds representation only: the authoritative registry remains the source for complete dependency resolution.

P2 provider-boundary work is now offline-tested. `CodexCliGateway` requires an explicit working directory, runs with a declared read-only ephemeral profile that ignores ambient user configuration and rules, checks cancellation before spawning, and kills then drains a cancelled or timed-out child. Its parser rejects malformed JSONL, terminal failures and streams without `turn.completed`; it aggregates every completed turn's input, cached-input and output tokens without inventing missing values. It retains a bounded raw JSONL/stderr artifact plus deduplicated observed command and tool counts. A Codex subprocess is recorded as one executor attempt while underlying model-call count remains unknown. Schema v26 adds a separate durable provider-attempt record: request and configuration fingerprints commit before dispatch, a terminal response commits only after it returns, and recovery changes any dispatched record to indeterminate without replaying it. `provider-smoke` connects this path to a disposable directory and explicit 60-second limit. On 2026-09-20, a `gpt-6-astra` request returned the exact smoke response in 12.8 seconds with 13,866 input, 11,520 cached-input and 8 output tokens, zero observed commands/tools and unknown monetary cost. A preceding filesystem-sandbox initialization failure is retained separately as indeterminate; it sent no terminal JSONL response.

P3 now has an evaluator-first TypeScript refactor fixture. A restricted full-file patch binds its task and source fingerprints, changes only the declared source path and is materialized into a fresh workspace. The evaluator lives outside that workspace and invokes Bun under a Bubblewrap user/PID/network namespace with a read-only workspace, disabled network, 1 GiB address-space limit, five-second CPU limit and ten-second wall limit. A terminal evaluation durably retains the frozen source and patch, their hashes, evaluator/profile hashes, command result and outcome under the run; a linked provider attempt must be completed and belong to that run. The `m3-refactor` command accepts only the terminal canonical JSON artifact, retaining the complete Codex JSONL separately. On 2026-09-20, the default `gpt-6-astra` pilot generated a verified patch under run `m3-refactor/a9725e94-df95-4469-80f9-a0e88284915d`: all three trusted tests passed; the provider reported 14,134 input, zero cached-input and 150 output tokens, and zero observed commands/tools. Monetary cost and underlying model-call count remain unknown. A preceding malformed-artifact attempt is retained as a failed run. This host cannot apply an RLIMIT_NPROC cap before Bubblewrap user-namespace setup, so the profile does not claim an enforced process-count bound. The later frozen two-call development cohort verified both default and the implemented checklist intervention, but the checklist consumed 14,260 total tokens against default's 14,241 with the same verified result. The deterministic policy retained the default and left the held-out task untouched. This is a valid negative development observation, not evidence of a useful intervention or a Gate C promotion.

Further P0 progress: evidence writes now verify canonical payload hashes. Normalization evidence uses a versioned envelope with original input, result, exact candidate/manifest and evaluator identity; storage validates output preservation and commit rechecks candidate binding and payload integrity. Regression assertions reject arbitrary fingerprints, label-only payloads, omitted/changed records and evidence for another candidate (78 tests, 266 assertions). Canonical sorting now uses explicit string ordering instead of host locale. This is fixture envelope validation, not trusted execution provenance or exhaustive candidate validation; those remain P1 requirements. Legacy normalization evidence without this envelope is preserved but cannot authorize new commits. Other evidence producers must now supply the actual canonical payload hash.

Implementation progress: the first P0 repairs are implemented. Provider responses now produce unevaluated records with success=false; receipt issuance and commit require active direct dependencies; M4 rejects cross-split task reuse and unrelated candidates, returns inconclusive for unmatched held-out tasks, and includes the policy in its assessment fingerprint. Regression checks pass (78 tests, 259 assertions). Fabricated evidence, upgrade compatibility, full admission binding and the remaining P1–P5 work are still open. The findings above describe the audit baseline.

### P0 — Establish honest results and fail-closed boundaries

- Mark prior M3/M4 reports as transport-only, unevaluated historical smoke data; exclude them from promotion cohorts.
- Separate provider completion, task evaluation and admission statuses. Missing evaluators yield unevaluated, never success.
- Add regression cases for fabricated evidence, already-suspended dependencies, invalid receipts, unmatched cohort tasks, and incomplete provider streams.
- Audit existing database layouts; add compatible upgrade tests and repair migrations without deleting data or renumbering historical migrations.

Exit: failures are reproducible, existing data remains readable, and no smoke response can become admitted coding evidence.

### P1 — Finish the offline mechanism (Gate A)

- Freeze a small finite normalization domain, distinct slow/fast capabilities and a classifier with explicit eligibility conditions.
- Use the checked graph/frame path to execute baseline and classifier/route revision; independently verify original inputs against outputs and audit mappings across the complete domain.
- Add a single admission service that validates child/governor authority, exact base/candidate/manifest, evaluator/policy, evidence integrity and active support. Mint receipts only through it; recheck at commit.
- Propagate revocation to affected admissions and block new effects. Update the bounded shared projection in the same transaction as accepted revisions and status changes.
- Provide one CLI demonstration linking child, evidence, receipt, head change and subsequent execution; exercise rejection and restart cases through the same path.

Exit: one offline end-to-end test and runnable demo prove an authorized child changes only future pinned execution; invalid or revoked support cannot commit or dispatch.

### P2 — Establish a reliable measured provider boundary

- Fix/test JSONL parsing, terminal errors, pre-cancellation, timeouts, process cleanup and multi-turn usage. Preserve raw bounded artifacts, input/output/cached tokens and observed command/tool counts; leave unavailable monetary cost unknown.
- Diagnose missing batch records using fake subprocess fixtures first. Pin model/configuration and use an explicit disposable working directory.
- Treat Codex CLI as an external agent executor with its own orchestration. Record that experimental scope explicitly; do not count one subprocess as one underlying model call or attribute its context policy to Government.
- Connect provider attempts to durable intent/completion records. Interrupted calls remain indeterminate unless attributable evidence resolves them.

Exit: one bounded live call after offline adapter tests yields an auditable terminal record; no silent replay and no invented usage.

### P3 — One useful isolated coding task (Gate B)

- Build one small TypeScript refactor repository with a pinned container profile, enforced filesystem/network/resource bounds, and an evaluator outside the editable workspace.
- Produce a patch, apply it to a fresh source snapshot and run independent type/behavior checks. Persist source, patch, evaluator hash, output, usage and outcome under one run ID.
- Start with the default strategy. Add only one implemented intervention after the default works. Keep context-summary comparisons deferred until context processing is measurable.
- Freeze task identities, exact prompts, repetitions, model, budgets and development/assessment allocation before spending tokens. Start with a small development pilot; use it to set the final sample and spend budget. Do not claim statistical power from an arbitrary small cohort.

Exit: a single CLI command produces a reproducible verified patch and report, followed by a matched fixed-strategy comparison. All costs, unknowns and failed attempts remain visible.

### P4 — Adaptive assessment (Gate C)

- Select/freeze the best eligible fixed comparator using development data. Use untouched, matched assessment tasks and consistent explicit cost units.
- Bind evidence to experiment/model/evaluator/policy versions; reject task leakage, unrelated candidates and mismatched task sets. Include discovery and unsuccessful-candidate costs.
- Implement one scoped route proposal over registered variants with explicit unknown/failure/budget fallback, using P1 admission.
- Publish a reproducible supported-benefit, retain-fixed or inconclusive report. A negative result is valid; it does not prove a promoted adaptive MVP.

Exit: an independently reconstructable assessment and, only if supported, a committed route used by subsequent execution.

### P5 — Revisit M5–M7

Keep these visible as unimplemented. M5 remains gated on a reviewed Gate C outcome; the current M3 result selected the fixed harness and did not supply an adaptive candidate. Implement M6 only for a demonstrated long-running workload and M7 for a concrete distribution target. Documentation alone does not complete any of these milestones.

## Economical execution

Stop paid live comparisons until success evaluation is real. Reuse the graph/frame, SQLite and writer-lock code; avoid a rewrite. Deliver whole observable behaviors with negative tests rather than another sequence of isolated tables and getters. One lead owns storage/runtime changes. If delegation is requested, use bounded independent review/test tasks and require demonstrated acceptance evidence before integration. Run targeted checks while editing and one full check per coherent delivery. The immediate next implementation is P0, then P1; no additional M4 feature work is needed yet.
