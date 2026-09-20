# M4 — deterministic assessment runner

The M4 runner assembles a reproducible assessment artifact from provider-neutral observations. It validates unique task/candidate observations, separates discovery from held-out data, sorts each cohort deterministically, and applies the frozen held-out benefit policy only to the held-out cohort. The artifact retains discovery for cost and lineage review, records the promotion or fallback decision, and carries a SHA-256 fingerprint for durable evidence binding.

This runner does not invoke a model, choose tasks, or publish a production revision. A live M3 executor can supply observations later; the same artifact and policy then provide the M4 decision boundary.
