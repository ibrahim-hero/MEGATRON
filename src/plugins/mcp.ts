import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ToolSpec } from '../core/ports.ts';
import type { MegatronSettings } from '../policy.ts';
import { VERSION } from '../version.ts';
type Server = MegatronSettings['mcp'][number];
/** MCP JSON-RPC over stdio or Streamable HTTP, including native tool schemas. */
export class McpClient {
  config: Server; cwd: string; child?: ChildProcessWithoutNullStreams;
  private nextId = 0; private buffer = ''; private session?: string;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(config: Server, cwd: string) { this.config = config; this.cwd = cwd; }
  async connect() {
    if (this.config.transport === 'stdio') {
      if (!this.config.command) throw new Error('MCP stdio requires a command');
      this.child = spawn(this.config.command, this.config.args ?? [], { cwd: this.cwd, stdio: 'pipe', windowsHide: true });
      this.child.stdout.on('data', chunk => {
        this.buffer += String(chunk); let i;
        while ((i = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 1); try { const msg = JSON.parse(line); const p = this.pending.get(msg.id); if (p) { clearTimeout(p.timer); this.pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); } } catch { /* Other stdout is not a protocol response. */ } }
      });
      this.child.stderr.on('data', () => {});
      const failed = (e: Error) => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); } this.pending.clear(); };
      this.child.on('error', failed); this.child.on('exit', () => failed(new Error('MCP process exited')));
    }
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'MEGATRON', version: VERSION } });
    await this.notify('notifications/initialized', {});
    return this;
  }
  async request(method: string, params: unknown): Promise<any> {
    const id = ++this.nextId; const payload = { jsonrpc: '2.0', id, method, params };
    if (this.config.transport === 'http') return this.http(payload);
    if (!this.child) throw new Error('MCP is not connected');
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 30000); this.pending.set(id, { resolve, reject, timer }); this.child!.stdin.write(`${JSON.stringify(payload)}\n`); });
  }
  async notify(method: string, params: unknown) { const payload = { jsonrpc: '2.0', method, params }; if (this.config.transport === 'http') await this.http(payload); else this.child?.stdin.write(`${JSON.stringify(payload)}\n`); }
  private async http(payload: any) {
    if (!this.config.url) throw new Error('MCP HTTP requires a URL');
    const r = await fetch(this.config.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(this.session ? { 'mcp-session-id': this.session } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    this.session = r.headers.get('mcp-session-id') ?? this.session;
    if (r.status === 202 || r.status === 204) return;
    if (!r.ok) throw new Error(`MCP HTTP ${r.status}`);
    let data: any;
    if (r.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = r.body!.getReader(); let text = '';
      try { while (!data) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); for (const match of text.matchAll(/^data:\s*(.+)$/gm)) { try { const parsed = JSON.parse(match[1]); if (parsed.id === payload.id) data = parsed; } catch {} } } } finally { await reader.cancel(); }
    } else data = await r.json();
    if (data?.error) throw new Error(data.error.message); return data?.result;
  }
  async tools(): Promise<ToolSpec[]> { const r = await this.request('tools/list', {}); return (r?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })); }
  async call(name: string, args: unknown) { const r = await this.request('tools/call', { name, arguments: args }); return { ok: !r?.isError, text: (r?.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join('\n') }; }
  async close() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('MCP closed')); } this.pending.clear();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) await new Promise<void>(resolve => { this.child!.once('close', () => resolve()); this.child!.kill(); });
  }
}
