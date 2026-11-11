# Publishing the new MEGATRON repository

The repository publisher uses the GitHub CLI and the authenticated account. It creates a **new public `MEGATRON` repository**, stages only intended source/docs/assets, creates the initial commit, and pushes `main`. It stops if a repository with that name already exists. It does not change global Git configuration or force-push.
The prepared workspace can also reuse ibrahim-hero’s existing Git Credential Manager sign-in through an in-memory credential handoff to GitHub CLI.

In the prepared Windows workspace, authenticate with the portable tool on G:

```powershell
$env:GH_CONFIG_DIR = "G:\opencode projects\megatron\tools\github\config"
& "G:\opencode projects\megatron\tools\github\bin\gh.exe" auth login --hostname github.com --git-protocol https --web
node scripts/publish-github.mjs
```

On another machine, install `gh`, sign in with `gh auth login`, and run the publisher from the MEGATRON repository. The script uses the signed-in account as the owner; no token belongs in chat, source files, or commits.

Local release archives and the `.vsix` are generated separately with `npm run package`. They include code, tests, documentation, screenshots, and the walkthrough video, while excluding credentials and runtime state.
