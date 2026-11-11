# Architecture

## Flow

```text
GitHub / Feishu / signed webhook / local request
                    |
                Trigger -> Thread -> gate + assessment
                    |                   |
              subscription context    Decision
                                        |
                               Ticket + immutable Mandate
                                        |
                         Assignment -> worker / checkpoint
                                        |
                         host-owned verification receipts
                                        |
                          fingerprint-bound action decision
                                        |
                         immutable bundle / declared action
```

## Composition and ownership

- `src/core/model.ts` and `ports.ts`: typed facts and external boundaries.
- `src/engine.ts`: synchronous domain commands; the only ticket/assignment writer.
- `src/store/store.ts`: SQLite aggregate records, FTS5, append-only events, and leased effects.
- `src/effects.ts`: durable external work after transaction commit; coalesced pending keys do not lose work queued during execution.
- `src/outbox.ts`: ordered, idempotent channel receipts and notification timing.
- `src/executor/executor.ts`: per-ticket workspaces, slots, provider calls, verification, and actual artifact creation.
- `src/app/runtime.ts`: composition root, recovery, scheduler, integration wiring, and administration actions.
- `src/app/server.ts`: shared JSON API, same-origin controls, events, and static console.

The core does not execute a shell, contact a model, or send a remote message. Commands transact facts and queue effects. Adapters report the external outcomes back to the Engine.

## Evidence and delivery

Required verification commands are copied from operator-controlled repository settings into the Ticket. A worker’s `ready` report queues a host verification pass. Receipts contain the command, criterion, actual exit code/output, environment, duration, and SHA-256 tree fingerprint.

Trusted acceptance files are compared with the untouched baseline. Red/green criteria require a failing baseline. An empty receipt set cannot certify a mission. Changed work invalidates previous evidence and gates. Delivery independently checks the fingerprint and writes a complete immutable bundle before the domain records a delivered outcome.

## Checkpoints, tools, and restarts

Each model step stores its protocol transcript. Tool intentions and results have stable IDs; replay can reuse known completed results. An uncertain interrupted command returns a reconciliation instruction rather than automatically repeating an external effect. Workspace preparation preserves existing files. A process lock prevents two runtimes for the same state directory.

SQLite transactions support nested savepoints and post-commit callbacks. Leased running effects recover to the durable pending queue. Retry counters distinguish capacity deferrals from failures. Timed-out commands and MCP clients wait for process termination before releasing resources.

## Intelligence and coordination

The knowledge index is separate from authorization. It stores file content, hashes, symbols, imports, vectors, and historical task facts. Retrieval returns citations and excludes stale facts. Its offline vector implementation can be replaced through an embedding function without changing the query interface.

Workflow nodes define repository scopes, roles, file contracts, and dependencies. Scheduling rejects cycles and delays overlapping file contracts. Every node still receives its own Ticket and Mandate. A shared workflow does not implicitly widen a worker’s authority.

Speculative candidates run in independent workspaces and are judged by actual checks. The winner is copied into the mission workspace and independently re-verified before delivery. Skills are versioned workflow instructions that must pass separate holdout validation before publication.

## Providers and integrations

The provider adapter speaks native OpenAI and Anthropic tool protocols. Model routes carry capabilities and prices; observed verification success and latency feed routing. Keys are resolved from named environment variables.

Sources keep source-native identities. GitHub comments use stable edit IDs and hidden outgoing markers. Feishu replies use stable UUIDs. Signed webhooks pass through the same domain gate. Pinned plugins and MCP expose actual schemas to workers. Deployment integrations can supply health checks and rollback functions.

## Product surfaces

The CLI, console, VS Code extension, and mobile web surface share the management API. No surface owns a separate agent loop. The console prioritizes attention, then progress, then audit details. Full factual events remain available for replay and benchmark investigation.
