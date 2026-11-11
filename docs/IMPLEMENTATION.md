# Plan-to-code traceability

This is the implementation ledger for the original product plan. Each row names a runnable capability and its verification path. Planning targets in the original PDF are aspirations, not measured live-model results.

| Plan item | Implementation | Verification |
| --- | --- | --- |
| Benchmark/eval first | `src/bench/runner.ts`; fixtures; trace JSON; CI | Terminal benchmark; browser-triggered suite; adversarial false-ready case |
| Cost/attention | `src/ledger.ts`; console; `mg costs` | Idempotent messages; budget tests; measured per-case scorecards |
| Evidence readiness | `src/evidence.ts`; Engine verification; host-selected commands | Baseline exit 1 → fixed exit 0; stale tree refusal; unchanged trusted checks |
| Durable checkpoints | Worker transcripts; tool-run records; Engine recovery; retained workspaces | Nested transaction tests; effect coalescing; stopped-ticket and preparation tests |
| Approval gates | Delivery/application/publication/merge/deployment objects | Browser review/approve creates an actual bundle; stale head and fingerprint refusal |
| Sandboxes | Local adapter; constrained Docker command adapter | Path confinement, environment filtering, quoting, process-tree timeout; Docker requires an installed engine/image |
| Knowledge | FTS5, offline vectors, symbols/imports, sourced facts | Incremental index, dependents, source-hash invalidation, browser citation search |
| Work contracts | `src/workflows/dag.ts`; per-node file restrictions | Cycle/conflict checks; real backend/client dependencies and artifacts |
| Routing/speculation | `model-router.ts`; independent candidate runs | Capability selection; observed failures; actual failing/passing candidate comparison |
| Learning | `src/skills/learning.ts`; candidate → holdout → published | Training contamination refusal; clean two-task holdout; provenance retained |
| Multi-repo outcomes | Workflow scopes; dependency artifacts; rollout service | Backend/client fixture migration; declared health measurements and rollback receipts |
| Product surfaces | `mg`; `web`; VS Code extension; mobile manifest | CLI smoke; five browser journeys; 390px layout; installable extension packaging |

## Additional improvements carried through

- Attention-first overview and quiet notification timing.
- Native browser investigation with screenshot, DOM, network, and console evidence.
- Factual event replay for debugging the agent itself.
- MCP stdio and Streamable HTTP clients; SHA-256-pinned local plugin packages.
- GitHub/Feishu source adapters and HMAC-signed external intake.
- Declared deployment-health thresholds and durable rollback outcomes.
- Core execution and default indexing without network services; optional local-model inference.

## Operating prerequisites

Model API calls need a configured provider or local server. GitHub publication needs an authenticated GitHub CLI with repository access. Feishu needs its configured app and environment secret. Docker execution needs Docker and the prepared image. Browser investigation needs Playwright and an installed browser.

The default demo makes all scripted decisions explicit while using real source files, checks, checkpoints, gates, artifacts, and cost/attention records. Its measured scorecard validates those mechanics. Use configured-provider benchmarks to evaluate engineering quality and any competitive claim.
