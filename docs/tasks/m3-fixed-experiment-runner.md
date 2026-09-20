# M3 fixed experiment runner

The offline runner executes one frozen M3 variant through the provider-neutral typed model boundary. It records the run and task references, exact variant and model references, terminal outcome, model/tool call counts, latency, known or unknown token usage, error reason, and a deterministic response fingerprint.

The runner accepts an injected clock so latency assertions remain deterministic. Provider cancellation and failures remain unsuccessful outcomes with unknown usage; they are never represented as zero cost. Successful responses require a response fingerprint. Budget validation uses the frozen M3 manifest ceilings.

This is an offline measurement boundary. It does not claim coding-task success, persist records, or select a production provider. The next slice should connect these records to an isolated TypeScript refactoring evaluator and, separately, add an opt-in production adapter compatibility check.
