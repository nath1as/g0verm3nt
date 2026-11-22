# Repository-level evaluation reset

Status: benchmark researched, pinned cohort preparation implemented. Repository executor and official grading integration are not yet implemented or qualified. No benchmark model runs have been made. This is the current continuation plan; earlier synthetic repair protocols are closed research records.

## What changes

The earlier tasks supplied complete specifications, defect locations and small single-file implementations. Repeatedly adding mutations did not demonstrate greater model difficulty. Individual mutation qualification proved test sensitivity, not model challenge. V2 also changed its prompt and repeated the same contracts. The latest three-contract probe verified every first attempt, so its retry comparison never executed. Stop buying additional synthetic calibration runs. Keep those fixtures for runtime regression tests.

We will use externally curated repository issues, an established independent grader, and a fixed selection procedure. Difficulty will be observed after selection, never enforced by replacing successful tasks. No claim that Luna is the weakest available model is supported; use the same precisely configured worker in both arms to isolate the workflow effect.

## Benchmark selection and research basis

| Candidate | Role in this project | Limitation |
| --- | --- | --- |
| SWE-bench Verified | Selected first integration and feasibility pool: repository issue repair with published instances and grading infrastructure | Public historical tasks may be in model training; locally reserved tasks are not contamination-free |
| SWE-bench Live | Follow-up replication candidate when the integration works; prefer a pinned recent release rather than a moving dataset | Requires its corresponding evaluator/version and image qualification; recency reduces but does not prove absence of contamination |
| mini-SWE-agent | Reference for the fixed agent loop and optional external sanity baseline | Its model transport is not automatically compatible with our authenticated Codex subscription; a different harness/model path confounds intervention comparisons |

SWE-bench's official guide describes Docker-based patch evaluation and JSONL predictions with `instance_id`, `model_name_or_path` and `model_patch`. Unique evaluation run IDs matter because prior results can be cached. We will import official per-instance grading evidence instead of equating command completion with resolution. [Official evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/)

The Verified dataset is distributed by the benchmark maintainers. We pin its upstream test split at revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`; dataset version is distinct from our internal development/assessment allocation. [Dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified), [dataset documentation](https://www.swebench.com/SWE-bench/guides/datasets/)

SWE-bench Live explicitly restricts agent access to the problem statement and instance environment, excluding hints, gold patches, test patches and gold test labels; official evaluation must not guide repair. Adopt that separation here as well. Its Python and multilingual tracks have different evaluator recommendations, so we cannot silently exchange them. [Maintainer protocol and tracks](https://github.com/microsoft/SWE-bench-Live)

mini-SWE-agent demonstrates a simple shell-based agent and linear interaction history, with environment support beyond local execution. This is an appropriate reference baseline, without embedding its governance or claiming reproduction of its published score. [Maintainer implementation](https://github.com/SWE-agent/mini-swe-agent)

These sources establish a suitable task/evaluation regime, not an expected score for our worker. Small local samples must never be advertised as a SWE-bench leaderboard result.

## Frozen sampling and exposure

`tools/import-swebench-public.py` reads only four columns from the pinned parquet: instance ID, repository, base commit and problem statement. It records the source byte hash. The entire upstream parquet (which includes gold fields) stays in the controller's private storage and must never be mounted into the worker. Public projection is an allowlist, not a blacklist. The worker prompt receives only the selected instance's issue text plus task-independent instructions; repository/commit metadata configures the environment.

`src/experiments/swebench-cohort.ts` ranks repositories and instance IDs by SHA-256 under seed `government-repository-pilot-v1`, then samples round-robin across repositories. Select 22 distinct instances: two infrastructure smoke tasks, eight development tasks, twelve reserved assessment tasks. This is a practical bounded feasibility allocation, not a statistical power calculation. Input row order, reference solutions, patch lengths, changed-file names, historical solution rates and model outcomes cannot influence selection. Assessment entries in the manifest contain identifiers and problem hashes, not issue bodies or gold records. There is no assertion of repository-disjoint splits; repository correlation must be reported.

Freeze dataset and selector identities and exact IDs before work on solutions. Record qualification failures and exclusions against that manifest. Do not replace instances based on worker results. If an environment cannot qualify, stop and report it; any replacement requires a new prospective manifest preserving the original accounting and reason.

Preparation commands, with the pinned parquet already downloaded to private controller storage:

```sh
UV_CACHE_DIR=/tmp/government-uv-cache uv run --no-build --with pyarrow==23.0.1 python tools/import-swebench-public.py .government/swebench-import/verified.parquet .government/swebench-import/public-rows.json
bun src/experiments/swebench-cohort.ts .government/swebench-import/public-rows.json .government/swebench-cohort-2026-09-20
```

Both output files use exclusive creation. `launchReady: false` in the cohort is deliberate: dataset provenance and selection do not attest to a working environment, executor or grader. Keep the full source pool away from worker sessions even though the exported columns are public, so reserved assessment issue bodies do not enter development context.

## Integration work before model spending

1. **Official evaluator bridge.** Pin the SWE-bench evaluator commit, Python dependencies, container image digests, platform and dataset revision. Start with the two selected smoke instances, one worker at a time. Grade an empty patch and the maintainer gold patch in separate fresh evaluation containers. Require a reproduced failure and a gold resolution under the required tests; environment errors are indeterminate. Store command, grading report, logs, hashes and wall time. Never expose these gold artifacts or logs to the coding worker.
2. **Repository worker environment.** Materialize the base checkout without solution commits, test patches, privileged dataset fields or grader scripts. Grant repository search, reads, edits and execution of tests already present or authored by the agent. Capture a multi-file unified diff; validate paths and patch application in a fresh checkout. Grade in a separate fresh environment. Resolve evaluator-image mounts and git history so a worker cannot read future fixes, host credentials, the Docker socket, or private dataset files. Provider authentication remains in a controller transport, not in the candidate sandbox.
3. **Executor compatibility spike.** Current `CodexCliGateway` is read-only, ephemeral and used with a tool-free prompt; the existing workflow rejects observed commands. Do not relax that profile in place. Introduce a separate repository-executor contract with bounded command mediation, cancellation, complete usage and trajectory capture. Verify that local Codex authentication supports it. If using model-produced shell actions mediated by Government, account for repeated CLI prompt overhead and enforce the action cap before dispatch. If using the native Codex agent, both arms must use that same executor and isolation; claims concern Government's workflow around Codex, not an independently implemented agent loop. Compatibility must be measured, not inferred from the presence of the CLI.
4. **Budget/accounting spike.** Verify actual turn/tool bounds, per-command timeout and output bounds, process cleanup and no accidental retries. Freeze enforceable limits before live dispatch. A CLI completion's token count is retrospective, so label it as an observed spend threshold, never a guaranteed billing cap. Retain uncached input, cached input, output, wall time, environment/evaluation cost, and engineering/setup costs separately. Persist uncertain interrupted work and block replay.

Offline smoke budget: two instances, at most four official grading jobs (empty and gold per instance), one at a time, no model calls. Propose 30 minutes per build/evaluation job and 50 GiB aggregate downloaded/build storage for this spike; measure required resources before attempting either. Stop on a failed gate, do not automatically switch to a paid cloud service.

## First comparison: one concrete intervention

**Fixed baseline:** one repository coding session with the issue and the permitted shell/edit/test tools. It may investigate and run tests throughout; it is not artificially deprived of feedback.

**Intervention:** the same executor with an explicit verification checkpoint near the end of its budget. Government pauses work, records the proposed patch and the commands/results used to verify it, and gives the same worker one continuation to address its own repository-visible failures or an untested reported behavior. Require the checkpoint artifact to be retained and consumed by the continuation. Gold evaluation is terminal only and never supplies the continuation's feedback. If no continuation is needed, stop and charge only used work.

Both arms receive identical total action/token/wall ceilings. The checkpoint, new-session overhead, and continuation consume the intervention's own budget; the baseline may spend the equivalent remaining budget continuing its investigation. Both start from independent clean checkouts. No selection between patches by gold score. Freeze prompts, checkpoint timing and selection rules after the smoke stage, before the development cohort; it is not yet an executable comparison protocol.

Development maximum: eight tasks times two arms = sixteen rollouts, at most two model sessions per rollout (32 sessions total). Preliminary ceiling per rollout: 20 mediated actions, 15 minutes, 100,000 observed input-plus-output tokens, 8,000 output tokens per response. These are ceilings to validate in the compatibility spike, not authorization to launch an unsupported executor. Stop future dispatch after an overshoot or unknown usage and retain its cost. Alternate arm order by frozen task index. Each rollout is scored once at the end. Underlying model calls in a native executor may remain unknown; do not call one session one model call.

This tests an implemented verification workflow against a capable fixed baseline. It does not isolate every component of the checkpoint package, and it does not demonstrate learned adaptation. If the intervention benefits all task types, keep it as the fixed policy. Do not invent a learner to reproduce an obvious rule.

## Decision rules and central hypothesis

Report the full paired outcome table, discordant wins/losses, model/tool usage and failure categories. Environment failures remain visible; report both all-selected task outcomes and qualified-task descriptive results, never quietly remove difficult instances. Eight development tasks are only a feasibility screen. Repeated runs and a larger cohort are needed to estimate stochastic variability; repeated attempts on one issue are not independent tasks.

No useful tradeoff or uniform failure/success: stop this pilot and report it. Do not change effort, sample or budgets after viewing outcomes to manufacture a favorable result. Complementary outcomes: formulate a scoped candidate using only issue/repository-visible features and development traces. Freeze the proposer, feature grammar, authored control, best fixed control, statistical analysis and complete spend allowance before opening the twelve reserved assessment tasks. A twelve-task assessment remains exploratory and does not guarantee power; determine a larger confirmatory sample from pilot uncertainty before claiming reliable superiority.

Only independent assessment benefit permits admission and restart/reuse experiments. Report recurring performance separately from the cost of discovery, failed candidates, setup and validation. At equal quality, compute break-even only if measured recurring savings are positive. Higher success at higher cost is a tradeoff, not savings. This preserves the original hypothesis: child-originated workflow changes must yield reusable benefit that repays their costs.

If complementary workflow outcomes justify learning a selector, apply the [semantic decision contract](semantic-decision-contract.md). Keep its fitting, calibration and policy-selection data within development and separate by task lineage; an inadequate development sample requires a new prospective data plan, not access to reserved assessment. Compare a deterministic rule and a conventional small classifier before attributing value to an optional Laya backend. Applicability, calibration and budget-aware selection are design requirements for that later experiment; no classifier is added to the frozen two-arm comparison described here.

## Local readiness, checked 2026-09-20

Docker 29.8.0 is now available on kernel `7.2.6-arch2-1`; the earlier startup blocker is resolved. The first digest-pinned image pull timed out after 30 minutes on a slow connection; image provisioning remains the blocker. See the [smoke bridge implementation and recovery instructions](repository-benchmark-smoke.md). No container evaluation has run. Python dependencies are isolated from project runtime dependencies. The filesystem had about 1.2 TiB free; this is capacity evidence, not container readiness.

The bridge and offline qualification checks are implemented. Next executable slice is its four live base/gold controls on the two frozen smoke IDs after pinned local images are available. Do not claim this document, an imported dataset, or passing adapter tests constitutes a repository benchmark run.
