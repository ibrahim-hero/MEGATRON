# MEGATRON

### Evidence-first autonomous engineering.

![MEGATRON](assets/brand/social-card.svg)

MEGATRON is a self-hosted engineering workbench that turns an authorized request into a scoped mission, executes it in a resumable workspace, verifies the exact changed tree, and delivers a reviewable patch bundle. The CLI, web console, and VS Code extension share one backend.

**Quiet by design. Evidence by default.**

## Try it

Requires **Node.js 24 or newer**. The core uses Node’s built-in SQLite and native TypeScript support.

```powershell
# From the MEGATRON repository:
node bin/mg.js serve --demo
```

Open **http://127.0.0.1:3082**. The demonstration has a real checkout regression fix and a structured product question. Review the change and its executed evidence, then approve the patch bundle.

```powershell
# Full terminal demonstration: fixes, verification, approval, delivery,
# false-ready rejection, and competing speculative candidates.
node demo/run-demo.mjs

# CLI reference
node bin/mg.js --help
```

Demo decisions are explicitly scripted. Files really change, tests really execute, failed checks really block delivery, and checkpoints and receipts really persist. Arbitrary engineering tasks require a configured model provider.

![Mission Control](assets/screenshots/mission-control.png)

## Use a real model and repository

```powershell
node bin/mg.js init
node bin/mg.js repo add shop "G:\src\shop" --verify "node --test test/cart.test.js"

# Set the provider key in your own terminal; do not put it in settings.json.
$env:OPENAI_API_KEY = "your-key"
node bin/mg.js model add main --provider openai --model YOUR_MODEL --key-env OPENAI_API_KEY
node bin/mg.js run "Fix checkout discounts; preserve existing regression tests" --repo shop
```

Anthropic and OpenAI-compatible endpoints are supported, including local servers. Model pricing, capabilities, compute budgets, approval policies, repositories, and tool connections are versioned settings. See [Usage](docs/USAGE.md).

## The twelve-plan implementation

| Capability | Runnable implementation |
| --- | --- |
| Benchmark and evaluations | Five regression fixtures, adversarial false-ready rejection, trace export, configured-provider runs, CI |
| Cost and attention accounting | Per-mission tokens, configured-price cost, wall time, messages, decisions, and human inputs |
| Evidence-backed completion | Host-owned checks, red/green regression receipts, immutable check files, fingerprint-bound approval |
| Durable checkpoints | Per-step transcripts, tool receipts, resumable assignments, preserved workspaces |
| Approval gates | Delivery, local application, GitHub PR publication/merge, and deployment actions |
| Execution environments | Explicit local mode or a constrained Docker adapter; container mode never falls back silently |
| Project intelligence | SQLite FTS5, offline vectors, symbols/import graph, sourced facts, hash-based freshness |
| Coordinated work | Persisted dependency graphs, repository scopes, file contracts, conflict-aware scheduling |
| Routing and speculation | Capability/cost/outcome-based model routing; independently checked competing candidates |
| Validated learning | Versioned skills extracted from verified work; separate holdout validation before publication |
| Multiple repositories | Backend/client workstreams with dependent artifacts and separate mission mandates |
| Product surfaces | CLI, responsive dark/light console, VS Code review extension, installable mobile web surface, GitHub/Feishu/webhooks/MCP |

Measured rollout checks and declared rollback actions are also available through deployment integrations. Native browser investigation captures local-app DOM content, failing requests, console errors, and screenshots.

See [implementation traceability](docs/IMPLEMENTATION.md) for the source modules and verification coverage of each plan item.

## Verify it

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:e2e
node bin/mg.js bench --demo --state tools/bench-run --json
```

Windows browser tests use installed Microsoft Edge. On Linux/macOS install Chromium with `npx playwright install chromium`. The default scorecard measures the harness with declared scripts, not superiority over Claude Code. `bench --live` evaluates your configured models on the same fixtures.

## Documentation and assets

- [Usage and setup](docs/USAGE.md)
- [Architecture and recovery](docs/ARCHITECTURE.md)
- [Plan-to-code mapping](docs/IMPLEMENTATION.md)
- [HTTP API](docs/API.md)
- [Integration and plugin cookbook](docs/INTEGRATIONS.md)
- [Testing](docs/TESTING.md)
- [Publish the new repository](docs/PUBLISHING.md)
- [Product / UI / UX guide](docs/PRODUCT.md)
- [PDF product guide](docs/MEGATRON-Product-Guide.pdf)
- [Original planning PDF](docs/MEGATRON-Original-Plan.pdf)
- [Screenshots](assets/screenshots/) and [walkthrough video](assets/demo/megatron-walkthrough.webm)
- [VS Code extension](extensions/vscode/README.md)

```powershell
npm.cmd run package
# releases/MEGATRON-v1.0.0.zip
# releases/megatron-mission-control-1.0.0.vsix
# releases/SHA256SUMS.txt
```

## Design lineage

Inspired by the explicit domain model and attention philosophy of [dsh-superagent-prototype](https://github.com/ibrahim-hero/dsh-superagent-prototype). MEGATRON is an independent implementation with its own runtime and branding. It does not require DeepSeek Harness packages.

MIT license. See [LICENSE](LICENSE).
