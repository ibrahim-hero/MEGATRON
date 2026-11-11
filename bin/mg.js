#!/usr/bin/env node
// MEGATRON CLI entry. Node >= 24 strips TypeScript types natively, so we can
// point straight at the TS source — zero build step, zero dependencies.
import { runCli } from "../src/cli/mg.ts"

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`mg: ${err && err.message ? err.message : err}`)
  process.exitCode = err && err.exitCode ? err.exitCode : 1
})
