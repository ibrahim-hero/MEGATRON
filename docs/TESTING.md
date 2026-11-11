# Verification

The recorded Windows run passed **39 Node tests**, **6 browser scenarios**, all **5 positive regression fixtures**, and the adversarial false-ready rejection. See `VERIFICATION.json` and `assets/benchmark-scorecard.json` for the observed local results and their scope.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
node demo/run-demo.mjs
node bin/mg.js bench --demo --json
```

The Node suite covers transactions/savepoints, post-commit callbacks, durable effect coalescing, capacity deferral, native provider protocols, malformed tool arguments, execution boundaries, child environment isolation, process-tree timeouts, readiness, stale approval refusal, budgets, structured questions, mandate withdrawal, MCP, pinned plugins, source translation, PR head refusal, indexing/freshness/impact, dependency graphs, model routing, skill holdouts, and rollout/rollback receipts.

Playwright exercises actual browser journeys: review evidence and approve a real patch bundle; answer a structured worker question; keyboard navigation and cited search; a 390px mobile layout; all console routes; the browser-triggered regression scoreboard; and the worker’s native browser investigator.

The benchmark uses five independently checked repository fixes and one false-completion claim. It captures scorecards and factual traces. Failures are inspectable artifacts rather than prompt-only judgments.

Windows testing uses the installed Edge channel. Linux/macOS use installed Chromium. Docker is an external execution prerequisite; exercising its actual engine/image requires that environment. GitHub and Feishu API contracts have deterministic checks, while authenticated remote delivery requires your accounts and repository access. Real model protocol tests run against local HTTP fixtures; live quality benchmarking requires a configured provider.

`npm run assets` captures screenshots and a walkthrough video. Install Playwright’s FFmpeg helper first if needed. `npm run package` emits the complete source release and VS Code package with checksums.
