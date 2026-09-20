# Central hypothesis discovery result — 2026-09-20

Decision: **no useful tradeoff observed; stop after discovery**. All four direct repairs passed public and hidden checks. Every feedback workflow also passed on its first attempt. No retry, candidate generation, assessment, promotion, or reuse was executed. This is the protocol's preregistered discovery stop, not a failed adaptive assessment or evidence that adaptation in general is unviable.

## Observations

Executor: local Codex CLI with `gpt-6-astra`, read-only ephemeral profile, public fixture input only, and no observed commands or tool calls. Both workflows receive identical first-attempt prompts. Feedback runs get at most one retry only after public-check failure; no such failure occurred.

| Discovery task | Direct result | Direct tokens | Feedback result | Feedback tokens |
| --- | --- | ---: | --- | ---: |
| Clamp with reversed endpoints | Verified | 14,352 | Verified; no retry | 14,249 |
| Rolling sums and means | Verified | 14,420 | Verified; no retry | 14,483 |
| Step rounding with tie convention | Verified | 14,588 | Verified; no retry | 14,591 |
| Pagination and page count | Verified | 14,391 | Verified; no retry | 14,395 |
| Total | 4/4 | 57,751 | 4/4 | 57,718 |

The 33-token difference does not demonstrate feedback benefit: both policies took the same one-attempt path and outputs varied across independent calls. No stratified quality tradeoff was observed, so there is no evidence here for learning when to spend a retry.

Total observed use: **115,469 tokens across eight provider attempts**: 113,405 input (including 92,160 cached input) and 2,064 output. Summed provider-attempt elapsed time was 145.537 seconds. Underlying model-call count and monetary cost remain unknown. Engineering/subagent costs are not included in the provider-attempt token total; these totals describe the experiment calls, not the cost of building the harness. Sixteen evaluator records retain public and hidden outcomes. No attempt exceeded the frozen 20,000-input/2,000-output ceiling. There were no indeterminate attempts or experimental retries.

## Retained evidence

State directory: `.government/central-hypothesis-2026-09-20/` (local, gitignored). It holds the frozen manifest, corpus qualification, final report, host isolation qualification, and `government.sqlite` with provider transcripts and evaluated patches. Runs are `central/discovery/0` through `central/discovery/7`. Each has `/attempt/1`, `/attempt/1/public`, and `/attempt/1/hidden` records.

- Manifest fingerprint: `ec43d33b1e6e66e9b112f3c7879c5d2c071f384e38af3829d6048e3b0f35bb87`.
- Final canonical report fingerprint: `551edde1ced99be6066fdfda813c40e17298b088a1e835484d1553643ab7d552`.
- The twelve-task corpus was frozen before live calls. Assessment and reuse fixtures received offline oracle qualification only; they were never sent to the experimental model or used to select a route.

## Validation and limitations

`bun run check`: 141 passing tests, 660 assertions, one opt-in isolation integration test skipped in the ordinary suite. Its actual host qualification ran separately and passed filesystem/network isolation, process saturation, bounded-output termination, and wall-time termination. All twelve reference fixes passed and all twelve original bugs failed in the actual isolated evaluator. Offline tests additionally verified public and hidden oracles independently.

The evaluator enforces 64 processes, read-only workspace, disabled network, 64 KiB output, and ten-second wall time. Address space (1 GiB) and CPU time (five seconds) are per process, not aggregate cgroup budgets. These checks support the implemented profile and do not establish a general hostile-code isolation proof.

These are small authored tasks, and the implementing agents saw the corpus. The executor saw only each task's public input. This pilot is too small and too easy for this executor to establish useful specialization. It has not tested learned relation admission, persistence across real adaptive runs, or amortization; those conditional paths remain unimplemented.

## Continuation

Retain direct execution for this measured scope. Do not rerun or tune this cohort. A new experiment should first identify naturally occurring repair failures or a real task family with a measurable quality/cost tradeoff, then freeze fresh tasks and budgets. Making the same prompt slightly different or introducing artificial failures would not test the central hypothesis better.
