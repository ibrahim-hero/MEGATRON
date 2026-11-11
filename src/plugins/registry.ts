import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Store, ToolSpec } from '../core/ports.ts';
import { sha256 } from '../infra/files.ts';
import { validateArguments } from './schema.ts';
import { McpClient } from './mcp.ts';
export interface PluginManifest { id: string; name: string; version: string; module: string; sha256: string; tools: ToolSpec[] }
export class PluginRegistry {
  store: Store;
  private loaded = new Map<string, { spec: ToolSpec; run: (workspace: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }> }>();
  private clients: McpClient[] = [];
  constructor(store: Store) { this.store = store; }
  async install(manifestPath: string) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PluginManifest;
    if (!/^[\w-]+$/.test(manifest.id) || !manifest.name || !manifest.version || !Array.isArray(manifest.tools) || !manifest.sha256) throw new Error('Plugin manifest needs id, name, version, tools, and a pinned SHA-256');
    const module = resolve(dirname(manifestPath), manifest.module);
    if (sha256(await readFile(module)) !== manifest.sha256) throw new Error('Plugin module integrity mismatch');
    this.store.save('plugin', manifest.id, { ...manifest, module, enabled: true }); await this.load(manifest.id); return manifest;
  }
  async load(id: string) {
    const manifest = this.store.get<PluginManifest & { enabled: boolean }>('plugin', id); if (!manifest?.enabled) return;
    if (sha256(await readFile(manifest.module)) !== manifest.sha256) throw new Error('Installed plugin module changed');
    for (const t of manifest.tools) {
      const name = `${manifest.id}__${t.name}`;
      this.loaded.set(name, { spec: { ...t, name }, run: async (workspace, args) => {
        validateArguments(t.inputSchema, args);
        return new Promise(resolve => {
          const child = spawn(process.execPath, [manifest.module], { cwd: workspace, windowsHide: true, stdio: 'pipe' }); let out = ''; let error = '';
          const timer = setTimeout(() => { child.kill(); resolve({ ok: false, text: 'Plugin timed out' }); }, 30000);
          child.stdout.on('data', d => out = (out + String(d)).slice(-20000)); child.stderr.on('data', d => error = (error + String(d)).slice(-2000));
          child.on('error', e => { clearTimeout(timer); resolve({ ok: false, text: String(e) }); });
          child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, text: code === 0 ? out : error }); });
          child.stdin.end(JSON.stringify({ tool: t.name, args, workspace }));
        });
      } });
    }
  }
  async addMcp(client: McpClient) { await client.connect(); for (const spec of await client.tools()) this.loaded.set(`${client.config.id}__${spec.name}`, { spec: { ...spec, name: `${client.config.id}__${spec.name}` }, run: async (_workspace, args) => client.call(spec.name, args) }); this.clients.push(client); }
  tools() { return [...this.loaded.values()].map(t => t.spec); }
  async call(name: string, workspace: string, args: Record<string, unknown>) { const tool = this.loaded.get(name); if (!tool) throw new Error(`Unknown integration tool: ${name}`); validateArguments(tool.spec.inputSchema, args); return tool.run(workspace, args); }
  async close() { await Promise.all(this.clients.map(c => c.close())); }
}
