# Luna low-reasoning calibration — 2026-09-20

Result: **5/6 verified; still too easy under the frozen calibration rule**. This was six direct attempts with `gpt-5.6-luna` and explicit low reasoning. There were no feedback retries, format failures, tool calls, unknown-usage attempts, or infrastructure failures. No learned rule, assessment, promotion, or reuse was executed.

| Task | Public checks | Hidden checks | Total tokens |
| --- | --- | --- | ---: |
| Streaming record parser | Pass | Pass | 13,766 |
| Async work queue | Pass | Pass | 13,458 |
| Layered configuration merge | Pass | Pass | 13,040 |
| LRU cache with expiry | Fail | Fail | 13,305 |
| Event replay and checkpoint | Pass | Pass | 13,631 |
| Interval allocator | Pass | Pass | 13,376 |

The cache patch left an observable expiry-boundary defect: two entries expiring at time 100 were still counted when the clock reached 100, where the published contract and public test require zero live entries. This is a real task failure with public feedback available for a future development comparison. It is not yet evidence that feedback repairs it or that task features predict the best workflow.

## Accounting and artifacts

Total: **80,576 observed tokens**: 74,688 input (including 53,760 cached input) and 5,888 output. Summed workflow elapsed time was 170.377 seconds. Monetary billing, underlying model-call count, and engineering/subagent token costs are not included in this experimental token total. No observed attempt breached 30,000 input or 8,000 output tokens. The request timeout was 120 seconds; token ceilings are retrospective stop thresholds.

Local state is retained under `.government/luna-calibration-2026-09-20/` (gitignored): `manifest.json`, exact `corpus.json` and `implementation.json` snapshots, `qualification.json`, `isolation-qualification.json`, `report.json`, and `government.sqlite`. Provider attempts and public/hidden evaluation records are attached to `luna/calibration/0` through `luna/calibration/5`.

Manifest fingerprint: `55ff24365317b39b235f12f2aa204ef2fb055204dcba12b9ecdbc7b44cc1a861`.

Final canonical report fingerprint: `b03fa52ca2c491d97eea44ef7f4d1783565e97cd8e83ab5be1b4bc0f02037a32`.

## Qualification and interpretation

All six original implementations failed public and hidden suites independently; every reference implementation passed each suite independently inside the actual evaluator sandbox (24 qualification executions). References and hidden test source were excluded from model prompts. The actual host isolation probes passed filesystem/network checks, process saturation, output bounding, and wall-time termination. Memory and CPU limits remain per process; no aggregate cgroup bound is claimed.

Project check: 144 tests passed, 671 assertions. The ordinary suite skips the opt-in host isolation test; the corresponding actual host probes were run separately and passed. The Codex adapter test verifies explicit low effort and preserves prior command construction when effort is unspecified. A regression test verifies the larger output allowance without changing the earlier experiment's default limits.

The frozen rule targeted two to four successes among six. Five successes therefore does not meet calibration readiness; do not change that threshold after seeing the result. These are synthetic, deliberately buggy multi-invariant components, not sampled real repository issues. One attempt per task does not estimate reliability with precision. The result identifies a concrete failure to investigate but does not establish a useful learned routing opportunity.

Continuation should revise task difficulty on development data and freeze a fresh calibration budget. The failed cache case can be used for development feedback experiments, but can never be called an untouched assessment example. Hold workflow/model/effort fixed while calibrating difficulty, and retain every failed or unhelpful attempt in cost accounting.

The bounded one-attempt repair follow-up is recorded in [luna-cache-feedback-result.md](luna-cache-feedback-result.md). It verified the cache fix on this development case; it does not change the calibration decision or establish a general policy.
