# Luna cache feedback repair — 2026-09-20

Result: **verified**. One `gpt-5.6-luna` attempt at explicit low reasoning received the prior failed restricted patch and its bounded public-test diagnostic. It then passed the unchanged public test and the independent hidden suite: three tests and 797 assertions.

The retained patch came from `luna/calibration/3/attempt/1/public` under calibration manifest `55ff24365317b39b235f12f2aa204ef2fb055204dcba12b9ecdbc7b44cc1a861`. The repair run was separately qualified: the original source failed public verification, while the reference source passed both public and hidden verification inside the real isolated evaluator. The prompt was rejected during qualification if it contained reference or hidden-test source.

The repair changed the expiry comparison from `< now` to `<= now`; it also added an unnecessary purge before `clear`, which remained behaviorally valid. Observed usage was 14,352 tokens: 13,518 input (8,960 cached) and 834 output. The run made one provider attempt, used no tools or commands, and remained inside the 30,000-input, 8,000-output, and 120-second bounds. Monetary billing is not available from this executor.

Local evidence is retained under `.government/luna-cache-feedback-2026-09-20/` (gitignored), with manifest fingerprint `d69a5d6733320f5658bca6ed00fa84fe870e8f03e70c86c0be15eda2661c1c42`. It is a development repair result on a calibration task, not held-out evidence and not a basis for promotion or workflow selection. It shows that public failure feedback can repair this specific Luna failure once; it does not measure repair reliability or net value against direct retries.
