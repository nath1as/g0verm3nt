# Luna low-reasoning calibration v2 — 2026-09-20

Review correction: v2 reused all six contracts and suites and also changed the prompt. Its changes were not all independent behavioral defects: replacing replay cursor with event count is equivalent on reachable valid states. The combined-source qualification did not test individual mutations. The outcomes below remain valid for the frozen run, but do not establish new task families or increased difficulty. Continue with the [revised protocol](repair-discovery-protocol.md).

Result: **5/6 verified; still too easy under the frozen two-to-four-success rule**. Six direct `gpt-5.6-luna` attempts ran with explicit low reasoning. All provider usage was known; there were no feedback retries, tool calls, format failures, or infrastructure failures. No workflow comparison, learned route, assessment, promotion, or reuse was executed.

| Task | Public checks | Hidden checks | Total tokens |
| --- | --- | --- | ---: |
| Streaming record parser | Pass | Pass | 13,961 |
| Async work queue | Pass | Pass | 13,506 |
| Layered configuration merge | Pass | Pass | 13,299 |
| LRU cache with expiry | Fail | Fail | 13,615 |
| Event replay and checkpoint | Pass | Pass | 13,795 |
| Interval allocator | Pass | Pass | 13,332 |

The corpus was independently qualified before launch: every reference passed public and hidden suites, and every revised buggy source failed both. The sources added two defects per component outside the original corpus's public examples. Luna still repaired five components on its first attempt. Its cache patch retained the inclusive-expiry defect, so public and hidden evaluators both rejected it.

Observed total: **81,508 tokens** — 74,940 input, including 53,760 cached input, and 6,568 output. Monetary billing and underlying model-call counts remain unknown. State is retained under `.government/luna-calibration-v2-2026-09-20/` (gitignored), with manifest fingerprint `09fdcc2d47d24cc2a16a5839b1879bc6e711b246d2ca89376b398fe6884618dc`.

This result is development calibration data only. It repeats the original ceiling effect and shares its lone failure's behavior class, so it supplies no complementary outcome pattern from which to learn routing. Do not run feedback comparison on this corpus. A third calibration must use new component designs and a different fault family, rather than further mutations of these six implementations.
