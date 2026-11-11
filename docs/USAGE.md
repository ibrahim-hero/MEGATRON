# Using MEGATRON

## 1. Runtime and first launch

Use Node.js 24+. There is no transpilation step. The CLI and console use standard Node modules; development checks and optional browser investigation use the dependencies installed by `npm ci`.

```powershell
node bin/mg.js init
node bin/mg.js serve --demo
```

The default console URL is `http://127.0.0.1:3082`. `--port` changes it. `--state` selects an absolute or relative state directory. Defaults are under the current project’s `.megatron` directory, not your C-drive home directory. Demonstrations use a separate demo state.

## 2. The demonstration

```powershell
node demo/run-demo.mjs
```

This executes a checkout discount correction, captures red/green test evidence, approves and delivers a patch bundle, rejects a false completion claim, and compares an incorrect candidate with a passing candidate in separate workspaces. Output includes a timeline, summary, evidence receipts, and immutable patch artifacts under `demo/output`.

The console labels this mode clearly. Its scripted provider is useful for reproducible tests; it is not a substitute for a configured model on arbitrary requests.

## 3. Register an application repository

```powershell
node bin/mg.js repo add shop "G:\src\shop" --verify "node --test test/cart.test.js"
```

Edit the versioned settings to declare additional checks:

```json
{
  "repositories": {
    "shop": {
      "path": "G:/src/shop",
      "github": "owner/shop",
      "baseBranch": "main",
      "verify": [
        {"id":"tests","label":"Checkout regression","command":"node --test test/cart.test.js","timeoutMs":120000,"regression":true}
      ],
      "trustedTests": ["test/cart.test.js", "package.json"]
    }
  }
}
```

`regression: true` requires an exit-1 failing baseline and a passing patched run. Use it for a reproducible bug, not a new-feature check that already passes on the base. Trusted checks must remain unchanged. Verification is host-selected; model text cannot replace a required command with an easier one.

## 4. Connect a model

```powershell
$env:OPENAI_API_KEY = "your-key"
node bin/mg.js model add main --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY

$env:ANTHROPIC_API_KEY = "your-key"
node bin/mg.js model add reviewer --provider anthropic --model YOUR_MODEL --key-env ANTHROPIC_API_KEY
```

For compatible hosted or local APIs, supply `--base-url http://127.0.0.1:11434` (or your provider endpoint). Endpoints can include `/v1`; MEGATRON avoids duplicating that segment. Native tool-call and tool-result identifiers are preserved for both API formats.

Use `--input-price` and `--output-price` to set USD per 1,000 tokens, or edit model settings. Cost reporting uses these configured prices. The default demo prices are zero; live-provider prices must match your provider’s billing schedule.

The router filters required capabilities and considers observed verification outcomes, latency, and configured prices. Multiple routes let unsuccessful work move to a stronger eligible model. API keys remain environment-variable references and are not written into transcripts or settings.

## 5. Work on a mission

```powershell
node bin/mg.js run "Fix the checkout percentage-discount bug" --repo shop
node bin/mg.js ls
node bin/mg.js show TICKET_ID
node bin/mg.js diff TICKET_ID
node bin/mg.js replay TICKET_ID
node bin/mg.js ask TICKET_ID "Use the existing cart-wide discount behavior"
node bin/mg.js approve TICKET_ID
node bin/mg.js deny TICKET_ID "Please cover the rounding boundary"
node bin/mg.js stop TICKET_ID
node bin/mg.js retry TICKET_ID
```

Use `--json` for structured output. When a server is running for the selected state, CLI actions use its API rather than opening a second SQLite writer. Without a daemon, commands run and drain the local runtime themselves.

Approval authorizes creation of an immutable patch bundle. It does not claim a remote merge occurred. A source edit after verification invalidates the approval. The bundle contains `changes.patch`, `manifest.json`, the changed-tree snapshot, and receipts.

## 6. Explicit delivery actions

After reviewing a delivered bundle, request a separately scoped action:

```powershell
node bin/mg.js action TICKET_ID apply
node bin/mg.js approve TICKET_ID

node bin/mg.js action TICKET_ID publish-pr
node bin/mg.js approve TICKET_ID

node bin/mg.js action TICKET_ID merge
node bin/mg.js approve TICKET_ID
```

Local application checks that the original repository has not changed since the baseline. PR publication uses the configured repository’s Git data API and checks the original hashes of changed files. Merge checks the current PR head, a covering approval, CI results, and the small-change limit. GitHub branch protection remains authoritative.

For deployment, select an installed integration tool. Supply `healthTool`, `rollbackTool`, and `maxValue` in the action payload to execute a measured rollout. A failed health measurement invokes the declared rollback and records that outcome.

## 7. Execution boundaries and budgets

Local mode uses the operator’s OS identity. Its workspace path checks, excluded secret files, filtered child environments, and bounded commands are useful controls; local mode is not OS isolation.

For container execution, set `executor.sandbox` to `container`, install Docker, and prepare the configured image:

```powershell
docker pull node:24-bookworm-slim
```

The adapter uses a read-only container root, a scoped workspace mount, no network, dropped capabilities, process/memory/CPU limits, and the unprivileged image user. Missing Docker or an unavailable image fails the work; the adapter never switches back to local mode silently. Dependencies must already be available in the chosen execution environment.

Limits include worker count, steps, tokens, USD, wall time, and bounded automatic correction attempts. Timeouts kill process trees. Budget stops retain checkpoints and source changes for review or a later retry.

## 8. Project intelligence and reusable skills

```powershell
node bin/mg.js knowledge search "checkout discount" --repo shop
node bin/mg.js knowledge impact shop src/cart.js
node bin/mg.js knowledge index shop
node bin/mg.js skill propose TICKET_ID
node bin/mg.js skill validate SKILL_ID
```

Search combines exact FTS5 matches with deterministic offline vectors. Symbols and import relationships provide impact context. Facts require a file/hash citation or a verified-ticket fingerprint; changed source citations become stale on re-indexing and are excluded from retrieval. Verified deliveries add historical task evidence, not unqualified assertions about today’s branch.

Candidate skills retain their training-ticket provenance. Publication requires clean outcomes on separate holdout tasks. The default trial uses declared scripts; a live benchmark is necessary to measure model-quality improvements.

## 9. Coordinated repositories

```powershell
node bin/mg.js workflow demo --demo --auto-approve
```

The explicit demo flag runs the backend-to-client contract migration with demo approvals. Custom graphs can be submitted through the API. Each node declares a repository, role, file contract, dependencies, and requested outcome. Cycles are refused, overlapping same-repository edits are serialized, and completed artifacts unlock dependents.

## 10. Benchmarks, console, IDE, and mobile

```powershell
node bin/mg.js bench --demo --json
node bin/mg.js bench --live --json
npm.cmd run package
```

Install the generated VS Code `.vsix` with **Extensions → Install from VSIX**. Configure `megatron.url`; tokens use VS Code SecretStorage. The responsive console also supplies a web-app manifest for mobile home-screen installation.

For LAN access, set `MEGATRON_SERVER_TOKEN`, then run `serve --host 0.0.0.0`. The console asks for the token; it establishes a same-site HTTP-only session. Put externally reachable instances behind your usual TLS gateway. API clients can use the bearer token. The default server stays on loopback and rejects unrelated hosts and cross-origin mutations.
For a TLS reverse proxy, set `MEGATRON_PUBLIC_ORIGIN` to the exact public HTTPS origin and preserve its Host header. The server uses that configured origin for same-origin checks and sets Secure session cookies.

## 11. Recovery and offline execution

Stop with Ctrl+C. Restart against the same state directory. The runtime recovers leased effects, preserves workspaces, and resumes interrupted assignments from stored transcripts and tool receipts. A command whose external completion is uncertain is not blindly repeated.

The CLI, database, deterministic knowledge search, scripts, and fixtures work offline. A local OpenAI-compatible tool-calling model can supply real inference without an external provider. Remote sources and integrations remain optional.
