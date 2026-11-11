# HTTP API

Default: `http://127.0.0.1:3082`. JSON request bodies are capped at 1 MB. Mutations use POST. Errors have `{ "error": "...", "code": "..." }` when a domain code exists. A token-protected server accepts `Authorization: Bearer TOKEN` or its same-site browser session.

## Queries

| Route | Result |
| --- | --- |
| `GET /api/status` or `/api/overview` | Mode, work, attention, workers, sources, ledger, and health |
| `GET /api/tickets` | Mission summaries |
| `GET /api/tickets/:id` | Scope, assignments, evidence, gates, delivery, and costs |
| `GET /api/tickets/:id/diff` | Actual baseline-to-workspace patch and changes |
| `GET /api/tickets/:id/timeline` | Persisted factual events |
| `GET /api/events?since=SEQ` | Server-sent events with cursor IDs |
| `GET /api/knowledge?q=QUERY&repository=ID` | Ranked, cited, fresh context |
| `GET /api/knowledge/graph` | Indexed import nodes and edges |
| `GET /api/workflows` | Dependency graphs and node states |
| `GET /api/models` | Routes, prices, capabilities, and observations |
| `GET /api/costs` | Total and per-mission compute/attention accounting |
| `GET /api/benchmarks` | Background benchmark status and scorecards |
| `GET /api/skills` | Candidate/published/rejected skills |
| `GET /api/integrations` | Sources, plugins, MCP servers, tool schemas |
| `GET /api/settings` | Current revision and history |

## Commands

```json
POST /api/run
{"request":"Fix checkout discounts","repository":"shop"}

POST /api/demo
{"scenario":"shop"}

POST /api/tickets/ID/ask
{"text":"Use the v2 contract"}

POST /api/tickets/ID/approve
{"approvalId":"GATE_ID"}

POST /api/tickets/ID/deny
{"approvalId":"GATE_ID","note":"Please address rounding"}

POST /api/tickets/ID/stop
{"reason":"Superseded by another change"}

POST /api/tickets/ID/retry
{}

POST /api/tickets/ID/action
{"action":"apply"}
```

Actions create a separate gate. `publish-pr` and `merge` require the configured GitHub repository. Deployment can carry a payload such as:

```json
{"action":"deploy","payload":{"tool":"preview__deploy","healthTool":"preview__health","rollbackTool":"preview__rollback","maxValue":2500,"args":{}}}
```

`POST /api/workflows` accepts `{title,nodes}` or `{demo:true}`. Nodes declare `id,name,repository,request,role,dependsOn,files` and optionally a declared demo `scenario`.

`POST /api/knowledge/index` accepts `{repository}`. `POST /api/benchmarks` starts an isolated background suite and returns its job ID. `POST /api/skills/propose` accepts `{ticketId,name?}`. `POST /api/skills/validate` accepts `{id}` and executes separate baseline/candidate trials.

`POST /api/settings` accepts `{value,revision}`. A stale revision is refused. Sandbox/source changes return `needsRestart`. `POST /api/plugins` accepts a local manifest path selected by the operator. `POST /api/session` establishes the browser session from `{token}`.

## Signed webhooks

Configure `sources.webhooks.secretEnv`. Send an HMAC-SHA256 hex signature of the exact JSON bytes in `x-megatron-signature`.

```json
{"id":"event-123","repository":"shop","actor":"allowed-source-id","human":true,"addressed":true,"text":"Fix the failing checkout test"}
```

Use `POST /api/webhooks/intake`. Requests still pass through the allowed-list and mandate gate. Feishu events use `/api/webhooks/feishu`; configure the app, chat IDs, bot ID, and its source-secret environment references.
