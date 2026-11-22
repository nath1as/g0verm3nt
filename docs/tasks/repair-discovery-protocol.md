# Repair workflow discovery: revised protocol

Closed pilot: [the live result](repair-discovery-comparison-result.md) had three direct successes and no eligible retry branches. The current continuation is the [repository benchmark reset](repository-benchmark-plan.md). The preparation status below is historical; do not schedule more synthetic calibration from it.

Status: comparison controller implemented; no live comparison launched. This revision replaces the proposal to keep adding mutations until Luna meets a target success band. It defines a three-task development probe and a bounded follow-up comparison. Offline tests cover branching, public-only feedback, shared-prefix cost accounting, restart evidence, and fail-closed stops. No assessment or learning claim follows from offline qualification.

Controller commands: `bun src/experiments/repair-discovery-run.ts <new-state-directory> --qualify`, then `bun src/experiments/repair-discovery-run.ts <same-state-directory> --run`. The first command executes all 30 local reference/mutant checks and binds the current controller, corpus, protocol and runner. The second requires matching qualification, writes an exclusive launch manifest, snapshots sources and implementation, and records each branch's parent attempt, public evaluation and seed hash before dispatch. An existing manifest blocks replay. `report.json` is updated atomically; SQLite retains attempt intent, terminal usage and evaluation evidence. Abrupt process death can leave the report incomplete; inspect the database and preserve uncertainty rather than relaunching that manifest.

## Question and baseline

First ask whether public diagnostics improve one additional repair attempt relative to a fresh attempt with the same model and effort. Only then ask whether observable information predicts when the extra attempt is worthwhile. The central hypothesis remains learned workflow selection with independently verified, reusable benefits after setup costs; a repaired bug alone does not establish it.

The existing fixed feedback workflow already spends no additional model attempt when public tests pass. Easy successes therefore provide no intrinsic token saving for a learned pre-task route. The practical control is always retry once after a public failure. A future learned stopping policy must beat that control at matched quality or at a declared cost/quality tradeoff, using fresh assessment tasks.

## Historical corrections

Luna v1 and v2 each produced five successes among six tasks; their tasks are related development data. V2 reused the same contracts, references, tests, and feature values, and added prompt guidance. It was not six new component designs or a controlled change to difficulty alone. The replay cursor-to-event-count mutation is equivalent for reachable valid states. Reference-pass/combined-source-fail checks did not prove every individual mutation was meaningful. Preserve original manifests and observations; do not relabel these runs as independent replications or retrospectively alter their frozen stop rules.

The old two-to-four-success band was a calibration heuristic. This protocol does not require a particular success fraction or select tasks to manufacture complementary outcomes. Three tasks cannot estimate reliability or support a learned route.

## New development tasks

| Task | Interacting contract requirements | Individually qualified defects |
| --- | --- | --- |
| Nested atomic table | Sequential compare-and-set within atomic batches; nested commits remain undoable by outer rollback | Partial batch writes leak; inner commit erases outer savepoint; repeated-key comparisons use stale state |
| Single-flight invalidation | Promise identity, synchronous reentry, detached flights and replacement lifetime, exception conversion | Old settlement deletes replacement; synchronous throw escapes; registration occurs after reentry |
| Reentrant turn scheduler | Snapshot semantics, cancellation/replacement identity, inclusive deadlines, recovery after callback exceptions | Cancelled snapshot jobs execute; running guard remains set; deadline is exclusive |

Every contract is fully public. Hidden tests are derived from that contract and run separately from public tests. Each reference must pass both suites; the combined buggy implementation must fail both; each single-defect mutant must fail the hidden suite independently. Public coverage for each mutant is recorded but need not detect every defect. A source edit with no independently demonstrated behavioral violation is not a qualified defect. Qualified tests remain finite coverage, not a correctness proof. Authors can see the references; no blind task authorship is claimed.

Fixtures declare asynchronous and transactional behavior for descriptive coverage. These features vary, but each combination has at most one task; no predictive relationship can be learned from that alone. The old constant local-import/export-count features are not reused as a learner input for this corpus.

Offline command: `bun src/experiments/repair-discovery-qualification.ts <new-output-directory>`. It makes zero provider calls and records corpus, implementation, protocol and isolation identity, plus all 30 reference/mutant evaluations. A manifest cannot be overwritten.

## Bounded live development comparison

Keep the existing executor fixed: `gpt-5.6-luna`, explicit low reasoning, tool-free canonical patch output. Reuse the qualified public/hidden isolation profile and artifact limits. Before dispatch, freeze exact prompts, schedule, task sources, evaluator, limits and this protocol in a new immutable live manifest.

1. Run one direct attempt on each of the three tasks, completing all initial attempts before any branches. Public and hidden scoring are recorded, but only public failure determines eligibility for step 2. Invalid artifacts and infrastructure failures are distinct from reasoning failures.
2. For each eligible public failure, branch from that retained first attempt into two fresh sessions: feedback receives the original task, failed patch, and bounded public diagnostic; fresh retry receives just the original public task. Neither receives hidden results. Use a frozen alternating order by task index: feedback/fresh, fresh/feedback, feedback/fresh. This order is an economy measure, not randomized replication.
3. Both policies get at most two attempts per task including the shared first attempt. Original public successes terminate both policies. After a public failure each policy selects its own second artifact, with no best-of-two selection using hidden scores. A hidden failure after public success cannot trigger a retry.
4. Report all task outcomes, public-pass/hidden-fail gaps, paired recovery outcomes and usage. A shared prefix saves execution cost but correlates branches; count its usage once in actual experiment spend and once per policy in each counterfactual policy total. Do not sum those policy totals as actual spend.

Maximum live scope: three initial plus six branch attempts = nine provider attempts. Each has a 120-second deadline, observed 30,000-input/8,000-output-token ceilings, and existing 32 KiB replacement / 48 KiB patch bounds. Maximum sum of per-attempt observed ceilings is 342,000 tokens, not a hard billing cap. Actual usage can overshoot a retrospective ceiling; retain it and stop subsequent dispatch. Unknown usage, interruption, evaluator setup failure or a provider limit violation stops the schedule with retained evidence and no automatic replay. A malformed artifact in any attempt makes this small cohort inconclusive and stops further spending. Monetary billing stays unknown.

This phase deliberately compares the practical feedback package (prior patch plus diagnostics) with an independent retry. It does not isolate diagnostics from access to the prior patch. A later patch-only control is required before claiming diagnostics alone caused a benefit.

## Decision and continuation

- No public failures: no opportunity observed; stop this probe and report the ceiling effect.
- Only hidden failures: public feedback cannot address the observed gap; review public verification coverage before another experiment.
- Feedback and fresh retry tie, or fresh retry wins: no demonstrated benefit from the feedback package; do not build a learned route from these observations.
- Feedback recovers cases the fresh retry misses: a development signal only. Freeze a larger budgeted replication on different contracts before claiming reliability. Preserve every unfavorable result and all setup costs.
- Consistent benefit of always retrying after public failure: retain that simple policy. Learning needs a measurable additional advantage over it.

Learning remains a separate conditional stage. Before proposing a policy, collect enough repeated development outcomes to distinguish retryable and unproductive failures across task families. Freeze the observable feature grammar (public data only), fallback, comparator, cost/quality objective, and untouched assessment corpus before generating a candidate. No task ID, source hash, hidden result, or mutation label is an allowed feature. A candidate must beat both the best fixed policy and an authored public-failure rule on assessment. Then test persistence/reuse and report break-even including discovery and failed-candidate costs. Do not expand governance, TUI or recursive composition to compensate for absent experimental benefit.
