# Deterministic demonstration

Run `node demo/run-demo.mjs` from the repository root. No model API key is required.

The scripts use the same worker loop and tool boundary as configured providers. Their file reads, focused source changes, command runs, host verification, checkpoints, attention events, candidate comparison, approvals, and artifact delivery execute normally.

Fixtures cover percentage discounts, one-based pagination, slug normalization, a versioned API contract, and a client consuming that contract. Boundary tests are host-owned. A separate liar scenario reports ready without changing the broken code and must be rejected.

Output lives in the ignored `demo/output` directory. Public assets under `assets` are explicitly captured from a running demonstration, not fabricated completion examples.
