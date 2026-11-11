import { readFile } from 'node:fs/promises';
import type { ToolSpec, Sandbox } from '../core/ports.ts';
import { files, safePath, writeWorkspace } from '../infra/files.ts';
import type { KnowledgeIndex } from '../knowledge/index.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { validateArguments } from '../plugins/schema.ts';
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', maxLength: 200000 };
export const WORKER_TOOLS: ToolSpec[] = [
  { name: 'list_files', description: 'List source and documentation files in the workspace.', inputSchema: object({}) },
  { name: 'read_file', description: 'Read a bounded workspace file.', inputSchema: object({ path: str }, ['path']) },
  { name: 'write_file', description: 'Write a workspace source file. Trusted acceptance checks cannot be weakened.', inputSchema: object({ path: str, content: str }, ['path', 'content']) },
  { name: 'run_command', description: 'Run a command in the configured execution environment and inspect exit code/output.', inputSchema: object({ command: str, timeout_ms: { type: 'number' } }, ['command']) },
  { name: 'search_code', description: 'Search workspace file content for exact text.', inputSchema: object({ query: str }, ['query']) },
  { name: 'knowledge_search', description: 'Retrieve sourced, freshness-stamped project context.', inputSchema: object({ query: str }, ['query']) },
  { name: 'record_hypothesis', description: 'Record a falsifiable debugging hypothesis, experiment, and observed evidence.', inputSchema: object({ cause: str, experiment: str, observation: str }, ['cause', 'experiment', 'observation']) },
  { name: 'browser_inspect', description: 'Inspect a local development application, including visible content, failing requests, console errors, and a saved screenshot.', inputSchema: object({ url: str }, ['url']) },
  { name: 'report', description: 'Report progress, ready, blocked, failed, or dropped. Ready requests host verification; it cannot certify its own success.', inputSchema: object({ state: { type: 'string', enum: ['progress', 'ready', 'blocked', 'failed', 'dropped'] }, summary: str, question: { type: ['string', 'null'] }, checkpoint_plan: str, checkpoint_next: str }, ['state', 'summary']) },
];
export interface ToolCtx { workspace: string; repository: string; sandbox: Sandbox; trustedFiles: string[]; allowedFiles?: string[]; knowledge?: KnowledgeIndex; plugins?: PluginRegistry; signal?: AbortSignal; onHypothesis?: (data: Record<string, unknown>) => void }
export async function execTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  try {
    const spec = WORKER_TOOLS.find(t => t.name === name);
    if (!spec) return ctx.plugins ? await ctx.plugins.call(name, ctx.workspace, args) : { ok: false, text: `Unknown tool: ${name}` };
    validateArguments(spec.inputSchema, args);
    switch (name) {
      case 'list_files': return { ok: true, text: (await files(ctx.workspace)).join('\n').slice(0, 12000) };
      case 'read_file': return { ok: true, text: (await readFile(await safePath(ctx.workspace, String(args.path)), 'utf8')).slice(0, 40000) };
      case 'write_file': {
        const path = String(args.path).replaceAll('\\', '/');
        if (ctx.trustedFiles.includes(path)) throw new Error('This is a host-owned acceptance-check file');
        if (ctx.allowedFiles?.length && !ctx.allowedFiles.some(p => p === '*' || path === p || path.startsWith(p.replace(/\*$/, '')))) throw new Error('File is outside this subtask contract');
        await writeWorkspace(ctx.workspace, path, String(args.content)); return { ok: true, text: `Wrote ${path}` };
      }
      case 'run_command': { const r = await ctx.sandbox.run(ctx.workspace, String(args.command), { timeoutMs: Math.min(Number(args.timeout_ms ?? 60000), 120000), signal: ctx.signal }); return { ok: r.exitCode === 0, text: `Exit ${r.exitCode}\n${r.stdout}\n${r.stderr}`.slice(-12000) }; }
      case 'search_code': { const matches: string[] = []; for (const p of await files(ctx.workspace)) { try { const text = await readFile(await safePath(ctx.workspace, p), 'utf8'); text.split('\n').forEach((l, i) => { if (l.includes(String(args.query))) matches.push(`${p}:${i + 1}: ${l}`); }); } catch {} } return { ok: true, text: matches.slice(0, 60).join('\n').slice(0, 12000) }; }
      case 'knowledge_search': return { ok: true, text: JSON.stringify(await ctx.knowledge?.search(String(args.query), ctx.repository) ?? []) };
      case 'record_hypothesis': ctx.onHypothesis?.(args); return { ok: true, text: 'Hypothesis and observed experiment recorded' };
      case 'browser_inspect': { const { inspectBrowser } = await import('./browser.ts'); return { ok: true, text: JSON.stringify(await inspectBrowser(ctx.workspace, String(args.url))) }; }
      case 'report': return { ok: true, text: 'Report recorded' };
    }
    return { ok: false, text: 'Unsupported tool' };
  } catch (err) { return { ok: false, text: String(err) }; }
}
