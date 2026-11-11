# MEGATRON Mission Control for VS Code

Start `node bin/mg.js serve` (or `serve --demo`) from the MEGATRON repository.
Install the generated `.vsix` from `releases/` with **Extensions → Install from VSIX**.
The MEGATRON activity-bar view lists real missions from the running API.

- Click a mission to inspect its actual changes in a script-free review webview.
- Use **MEGATRON: Approve Delivery** to decide its evidence-bound patch-bundle gate.
- **MEGATRON: New Mission** submits a repository-scoped task.
- Configure `megatron.url` for a different port or host.
- For token-protected servers, run **MEGATRON: Set Server Token**. Tokens use VS Code SecretStorage.

The extension shares the backend with the CLI and web console; it does not duplicate the agent engine.
