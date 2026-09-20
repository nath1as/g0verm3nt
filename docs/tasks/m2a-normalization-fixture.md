# M2a: normalization fixture foundation

The normalization fixture has one deterministic catalogue with a finite decoded-input shape, canonical output, and separate fast and slow capability contracts. The baseline is an unconditional slow call. The revised graph routes inputs of zero or one record to fast and two-record inputs to slow, with the eligibility bound declared in the input schema. Both definitions are checked against the exact same catalogue manifest, so later proposals can point at stable graph identities without consulting a mutable latest version.

The finite domain is explicit and tested for route selection and canonical results. The persisted runtime dispatches the planned fast or slow capability implementation, rather than calculating a result before graph execution; the fast capability rejects inputs outside its declared route domain.

The fixture also exposes a pure evaluator that sorts records deterministically, rejects duplicate IDs, preserves the batch identity, and emits a complete audit mapping.
