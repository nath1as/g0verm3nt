# Central hypothesis experiment: learn when to verify and retry

Status: discovery implementation ready. The twelve-task corpus, bounded feedback workflow, isolated public/hidden evaluator, discovery controller, and offline stop rules are implemented. Candidate generation, coding admission, assessment, and reuse remain conditional follow-ups if discovery supplies a useful tradeoff. No observations have yet been collected for this experiment; the controller freezes an exact manifest before the first provider call. No promotion is authorized by this document.

Run corpus qualification with `bun src/experiments/central-hypothesis-run.ts <state-directory> --qualify`, then discovery with the same command without `--qualify`. The state directory must not contain a previous manifest: interrupted schedules are never automatically replayed. `manifest.json`, `qualification.json`, `report.json`, and the SQLite provider/evaluation records retain the experiment. The concrete discovery ceiling is twelve attempts; later-stage maxima below are not automatically scheduled.

The implemented evaluator additionally enforces 64 processes inside its user namespace and a 64 KiB aggregate output limit. Actual host probes qualified filesystem/network isolation, process saturation, output termination, and wall-time termination. CPU and address-space limits are per process, not aggregate cgroup limits. Offline task qualification is separate from model assessment: reference solutions are never included in model input.

## Question and scope

Can a child learn a scoped workflow-selection rule from coding outcomes, have that rule independently checked, and reuse it in fresh sessions with enough benefit to repay discovery and validation?

Test a bounded instance: TypeScript bug repair with the same executor model and configuration throughout. Compare direct repair with repair followed by at most one retry using public verifier feedback. This tests selecting among registered workflows. It does not test inventing arbitrary capabilities or recursive composer mutation.

The falsifiable hypothesis is that observable task features predict when a feedback retry improves verified success enough to justify its extra tokens. A learned route must outperform both the best fixed workflow and a simple authored route on fresh tasks. A route that merely reproduces the authored rule does not establish added value from learning.

## Registered workflows and controls

- Direct: one restricted patch attempt, followed by independent evaluation.
- Feedback retry: the same first-attempt prompt; if public checks fail, one additional restricted patch attempt with bounded public diagnostics. Otherwise stop after one attempt. No hidden evaluator feedback reaches either attempt.
- Best fixed: select direct or feedback retry from discovery only, maximizing verified successes and breaking ties by lower total tokens, then direct.
- Authored route: use feedback retry when the editable module imports a local module; otherwise direct. Freeze this rule before outcomes. This is an inexpensive heuristic control, not assumed ground truth.
- Learned route: a child proposes one finite decision table over predeclared features from discovery traces. Features initially are local-import presence and exported-function count (one versus multiple). No task IDs, source hashes, hidden-test content, or outcome-derived features. Unknown or unsupported features fall back to the frozen best fixed workflow.

The proposer receives discovery records only and can select the two registered workflows. It gets one proposal attempt. A deterministic checker rejects unsupported features, malformed tables, altered workflow contracts, and missing fallback. Rejection ends the pilot with no eligible candidate; do not silently substitute an authored learned candidate.

## Tasks and leakage boundary

Prepare twelve distinct tasks before provider execution: four discovery, four assessment, and four later reuse tasks. Include self-contained and local-dependency repairs in each split. Use different bug mechanisms across splits; renamed copies of the same bug are insufficient. Choose tasks for realistic variation, not to force the authored or learned rule to win.

Each task has frozen source, editable paths, public checks and a separate hidden evaluator. Both workflows see identical initial task information. Only public check diagnostics can trigger or guide a retry. Hidden evaluators score the final artifact and never guide candidate generation on assessment or reuse tasks.

The experiment controller must withhold assessment and reuse records from the proposer. Repository fixtures visible to the implementer are not evidence of blind task authorship; report that limitation. Existing trim-prefix and strip-suffix observations are excluded from this new cohort.

## Staged execution and ceilings

These are proposed maxima. Before launch, freeze exact tasks, workflow/prompt hashes, executor configuration, evaluator/isolation hashes, schedule, policy, and enforceable limits in an executable manifest.

1. Discovery: run both workflows on four tasks: eight workflow executions, at most twelve provider attempts. Preserve failed attempts and public-check output. If direct succeeds on every task and retry adds no benefit, stop with no useful tradeoff observed. Also stop if every feature cell selects the same fixed workflow or the observed differences do not support a nonconstant route.
2. Proposal: at most one provider attempt to produce a restricted route from discovery only. Freeze the checked route and best fixed comparator before opening assessment. The authored rule was frozen before discovery.
3. Assessment: independently execute best fixed, authored route, and learned route on four fresh tasks: twelve workflow executions, at most twenty-four provider attempts. Randomize execution order with a frozen seed. Do not tune the route after results. A negative or inconclusive result ends this pilot.
4. Reuse: only after the assessment gate passes, publish through a coding-specific admission path, reopen the workspace without a transcript, and execute the admitted route on four fresh tasks: at most eight provider attempts. Verify exact route/evidence restoration and independently score outputs. Exercise revocation before a further operation; it must block dispatch without pretending previously dispatched work was undone.

Maximum across all stages: 45 provider attempts, including the proposer; most stop paths use substantially fewer. Each attempt has a 60-second deadline and a bounded output artifact. Proposed observed ceilings are 20,000 input and 2,000 output tokens per attempt (990,000 total across the maximum schedule). CLI token counts are observed after completion, so these are stopping thresholds, not a guaranteed hard account-spend cap. A threshold breach stops subsequent scheduling and remains charged to the experiment. Do not describe one CLI attempt as one underlying model call.

Do not run later stages speculatively. No retries for failed experiment infrastructure calls; retain unknown usage and indeterminate outcomes explicitly. The controller must stop on interruption and require attributable recovery rather than replaying a provider attempt.

## Outcome and cost policy

Primary quality measure: independent hidden-evaluator success per task. Report task-level outcomes for all three assessment policies, including failures. For this small feasibility pilot, the learned route passes the benefit screen only if it has no fewer successes than either control, beats each control on success count or uses at least 10% fewer total tokens at equal success, and does not exceed either control's total tokens when claiming additional successes. Missing usage makes the cost-dependent decision inconclusive.

This deliberately small sample is a feasibility screen, not statistical confirmation or broad production assurance. A screen pass permits only the explicitly scoped demonstration admission and reuse test. General deployment needs a larger preregistered cohort.

Report input, cached-input, output, wall time, public/hidden evaluator work, and failed-call costs separately. Total tokens are a resource proxy, not money; monetary cost stays unknown unless actual applicable rates or billing are available. Never double-count cached tokens already included in input tokens.

Report both recurring execution cost and the complete experiment bill. Charge discovery, proposer, candidate validation, unsuccessful work, and publication overhead to the learning experiment. Show baseline-selection/setup costs separately for a fair incremental comparison; also provide the conservative result charging all learning setup costs to adaptation.

At equal verified quality and positive per-task token savings, compute conditional break-even reuse count as ceiling(setup tokens / mean recurring token saving). If savings are nonpositive, report no token break-even. If success rates differ, show successes and cost per verified success; do not turn a quality gain into token savings. Zero successes leaves cost per success undefined. Four reuse tasks can demonstrate restoration and execution, but do not establish amortization unless cumulative measured savings actually cover setup.

## Required implementation before launch

Reuse restricted patch parsing, durable provider attempts, SQLite evidence, and the independent evaluator. Add only the missing paths:

1. Distinct frozen tasks, a public-feedback runner, and hidden evaluation isolated from feedback. Verify actual filesystem/network/resource enforcement; the current profile has no enforced process-count limit and must not be described as fully complete.
2. A bounded two-attempt workflow with complete attempt/usage linkage and no retry after indeterminate dispatch.
3. A discovery-only finite-route proposer, deterministic validation, frozen comparator selection, and schedule/stop controller. Synthetic tests validate the controller only; they are never experimental evidence of benefit.
4. A coding-specific trusted admission and benefit receipt. The existing normalization-only receipt cannot authorize coding routes. Bind task scope, workflow/model/evaluator versions, evidence, policy, base version, and active dependencies; recheck at commit and dispatch.
5. An auditable report and restart/revocation demonstration, retaining original evidence and never updating the route from assessment feedback.

Deliver these as observable slices. A missing prerequisite is an explicit incomplete experiment, not a passing placeholder or a reason to fabricate outcomes.

## Interpretation

- No discovery tradeoff: this task/workflow pair offers no demonstrated opportunity; it does not refute all adaptation.
- Learned route ties the authored rule: retain the simple rule; learning overhead is unjustified in this scope.
- Assessment gain with no measured payback: promising selection, unproven economics.
- Verified held-out gain, admitted reuse after restart, and measured cost recovery: bounded support for the central hypothesis.
- Admission, isolation, or revocation failure: mechanism defect; repair before claiming a supported adaptive system.
