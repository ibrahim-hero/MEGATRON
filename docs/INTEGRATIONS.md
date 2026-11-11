# Integration cookbook

## GitHub

Authenticate the CLI in your own terminal. Set `sources.github` to `{repository,account,cli?,pollSeconds}` and give the corresponding configured repository its `github` owner/name. Configure source-native GitHub logins under `policy.sources.github.allowed`; bot identities go under that source’s `bots`. Identical names on different sources do not inherit each other’s permissions.

GitHub comment polling uses a durable cursor with overlap. Stable event IDs absorb replay. Outgoing comments carry hidden idempotency markers. A published PR is tied to the changed-file baseline, branch, and head receipt. A merge is a separate action with head, approval, CI, and size checks.

## Feishu

Configure `sources.feishu` with chat IDs, app ID, bot ID, and `appSecretEnv`. Configure the signed-webhook secret and deliver Feishu events to its webhook route. Mentions and direct chats are translated into the same Trigger model; app secrets are resolved from the environment. Replies use a stable UUID.
Use Feishu-native user IDs under `policy.sources.feishu.allowed`. Signed intake uses its own `policy.sources.webhook` permissions.

## MCP

```powershell
node bin/mg.js mcp add tools --command node --args '["G:/tools/my-mcp-server.mjs"]'
```

For Streamable HTTP, add an entry with `transport: "http"` and its `url` in settings. Restart to initialize configured connections. The client performs protocol initialization, discovers tool schemas, and invokes native tool calls. Tool names are namespaced by server ID.

## Pinned plugins

A plugin manifest names an executable module and its SHA-256. Installing is an operator action. Modifying the module after installation refuses reloading.

```json
{
  "id":"example",
  "name":"Example integration",
  "version":"1.0.0",
  "module":"runner.mjs",
  "sha256":"SHA256_OF_MODULE_BYTES",
  "tools":[{"name":"inspect","description":"Inspect the workspace","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]
}
```

The executable reads `{tool,args,workspace}` from stdin and returns text/JSON on stdout. Nonzero exits are tool failures. Arguments are checked against the declared schema. Keep effects within the declared workspace. Deployment plugins should expose idempotent deploy, health, and rollback operations.

## Native browser investigation

Workers can call `browser_inspect` on a local development URL. The optional Playwright adapter captures title, visible content, failing requests, console errors, and a screenshot under the workspace’s excluded `.tmp` area. It uses Edge on Windows and an installed Chromium browser elsewhere.

## Local and air-gapped inference

Use an OpenAI-compatible tool-calling endpoint on loopback. Local endpoints can omit an API key. SQLite, transcripts, default vectors, fixtures, and delivery artifacts remain local. Disable external sources and MCP connections for an offline deployment.
