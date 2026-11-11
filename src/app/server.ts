import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Runtime } from './runtime.ts';
import { runBenchmark } from '../bench/runner.ts';
import { diffTrees } from '../infra/files.ts';
import { feishuTrigger } from '../sources/feishu.ts';
import { scenarios } from '../bench/scenarios.ts';
import type { WorkNode } from '../workflows/dag.ts';
const web = fileURLToPath(new URL('../../web/', import.meta.url));
const MIME: Record<string, string> = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'styles.css': 'text/css', 'logo.svg': 'image/svg+xml', 'manifest.webmanifest': 'application/manifest+json' };
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > 1000000) throw new Error('Request body exceeds 1 MB'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8'); return { raw, data: raw ? JSON.parse(raw) : {} };
}
const send = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function ticketView(t: any) { return { ...t, assignments: t.assignments.map((a: any) => ({ ...a, checkpoint: a.checkpoint ? { ...a.checkpoint, transcript: undefined } : undefined })) }; }
export async function startServer(runtime: Runtime, options: { port?: number; host?: string; token?: string; demo?: boolean; publicOrigin?: string } = {}) {
  const host = options.host ?? '127.0.0.1'; const token = options.token ?? process.env.MEGATRON_SERVER_TOKEN;
  const publicOrigin = options.publicOrigin ?? process.env.MEGATRON_PUBLIC_ORIGIN;
  if ((!['127.0.0.1', 'localhost', '::1'].includes(host) || publicOrigin) && !token) throw new Error('Set MEGATRON_SERVER_TOKEN to enable LAN/mobile access');
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    try {
      const requestBase = `http://${req.headers.host}`; const base = publicOrigin ?? requestBase; const url = new URL(req.url ?? '/', base); const path = url.pathname;
      const remote = !['127.0.0.1', 'localhost', '::1'].includes(host);
      if (!remote && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(requestBase).hostname) && (!publicOrigin || req.headers.host !== new URL(publicOrigin).host)) { send(res, 403, { error: 'Unrecognized host' }); return; }
      const webhook = path.startsWith('/api/webhooks/');
      if (!webhook && req.headers.origin && req.headers.origin !== base) { send(res, 403, { error: 'Cross-origin request refused' }); return; }
      if (path === '/api/session' && req.method === 'POST') { const { data } = await body(req); if (!token || !equal(String(data.token ?? ''), token)) { send(res, 401, { error: 'Invalid session token' }); return; } res.setHeader('set-cookie', `megatron_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${publicOrigin?.startsWith('https:') ? '; Secure' : ''}`); send(res, 200, { ok: true }); return; }
      const bearer = req.headers.authorization?.replace(/^Bearer /, ''); const cookie = req.headers.cookie?.split(';').find(c => c.trim().startsWith('megatron_session='))?.trim().slice('megatron_session='.length);
      const authenticated = !token || equal(bearer ?? '', token) || equal(decodeURIComponent(cookie ?? ''), token);
      if (path.startsWith('/api/') && !webhook && !authenticated) { send(res, 401, { error: 'Authenticate with the server token' }); return; }
      if (webhook && req.method === 'POST') {
        const { raw, data } = await body(req); const secretEnv = runtime.settings.current.sources.webhooks?.secretEnv;
        const secret = secretEnv && process.env[secretEnv]; const signature = String(req.headers['x-megatron-signature'] ?? '');
        if (!secret || !equal(signature, createHmac('sha256', secret).update(raw).digest('hex'))) { send(res, 401, { error: 'Invalid webhook signature' }); return; }
        if (path.endsWith('/feishu')) {
          if (data.challenge) { send(res, 200, { challenge: data.challenge }); return; }
          const cfg = runtime.settings.current.sources.feishu; if (!cfg) throw new Error('Feishu is not configured');
          const trigger = feishuTrigger(data, cfg.botId); if (trigger && cfg.chats.includes(String(trigger.meta.chatId))) { trigger.meta.repository = data.repository; runtime.engine.receive(trigger); }
          send(res, 200, { ok: true }); return;
        }
        const repository = String(data.repository ?? ''); if (!runtime.settings.current.repositories[repository]) throw new Error('Unknown repository');
        const id = String(data.id ?? randomUUID()); const thread = `webhook:${String(data.thread ?? id)}`;
        runtime.engine.receive({ id, source: 'webhook', threads: [thread], human: data.human === true, addressed: data.addressed ? 'mention' : undefined, actor: { source: 'webhook', id: String(data.actor ?? '') }, text: String(data.text ?? ''), at: new Date().toISOString(), channel: { source: 'local', thread, address: {} }, meta: { repository } }); send(res, 202, { ok: true }); return;
      }
      if (req.method === 'GET') {
        if (path === '/api/overview' || path === '/api/status') { const view = runtime.overview(); send(res, 200, { ...view, tickets: view.tickets.map(ticketView), needs: view.needs.map(ticketView), working: view.working.map(ticketView) }); return; }
        if (path === '/api/tickets') { send(res, 200, runtime.store.tickets.list().map(ticketView).reverse()); return; }
        const ticket = path.match(/^\/api\/tickets\/([^/]+)(?:\/(diff|timeline))?$/);
        if (ticket) { const t = runtime.engine.require(ticket[1]); send(res, 200, ticket[2] === 'diff' ? await diffTrees(runtime.executor.baseline(t), runtime.executor.workspace(t)) : ticket[2] === 'timeline' ? runtime.store.events.since(0).filter(e => e.data.ticketId === t.id) : { ...ticketView(t), costs: runtime.ledger.summary(t.id) }); return; }
        if (path === '/api/knowledge') { send(res, 200, await runtime.knowledge.search(url.searchParams.get('q') ?? '', url.searchParams.get('repository') ?? undefined)); return; }
        if (path === '/api/knowledge/graph') { send(res, 200, runtime.knowledge.graph(url.searchParams.get('repository') ?? undefined)); return; }
        if (path === '/api/workflows') { send(res, 200, runtime.store.list('workflow')); return; }
        if (path === '/api/models') { send(res, 200, runtime.router.overview()); return; }
        if (path === '/api/skills') { send(res, 200, runtime.store.list('skill')); return; }
        if (path === '/api/integrations') { send(res, 200, { sources: runtime.sources.overview(), plugins: runtime.store.list('plugin'), mcp: runtime.settings.current.mcp, tools: runtime.plugins.tools() }); return; }
        if (path === '/api/costs') { send(res, 200, { total: runtime.ledger.summary(), tickets: runtime.store.tickets.list().map(t => ({ id: t.id, title: t.title, ...runtime.ledger.summary(t.id) })) }); return; }
        if (path === '/api/benchmarks') { send(res, 200, runtime.store.list('benchmark').reverse()); return; }
        if (path === '/api/settings') { send(res, 200, { value: runtime.settings.current, revision: runtime.settings.revision, history: runtime.store.list('settings-version') }); return; }
        if (path === '/api/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); let cursor = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0);
          const flush = () => { for (const event of runtime.store.events.since(cursor)) { res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.seq; } }; flush(); const timer = setInterval(flush, 750); req.on('close', () => clearInterval(timer)); return;
        }
        const file = path === '/' ? 'index.html' : path.slice(1); if (MIME[file]) { res.writeHead(200, { 'content-type': MIME[file], 'cache-control': 'no-cache' }); res.end(await readFile(join(web, file))); return; }
      }
      if (req.method === 'POST') {
        const { data } = await body(req);
        if (path === '/api/run') { send(res, 202, { ticketId: runtime.submit(String(data.request ?? ''), { repository: String(data.repository), scenario: data.scenario || undefined }) }); return; }
        if (path === '/api/demo') { send(res, 202, { ticketId: runtime.submitDemo(String(data.scenario ?? 'shop')) }); return; }
        const action = path.match(/^\/api\/tickets\/([^/]+)\/(approve|deny|ask|stop|retry|action)$/);
        if (action) {
          const id = action[1]; let value: unknown;
          if (action[2] === 'approve' || action[2] === 'deny') value = await runtime.approve(id, data.approvalId, action[2] === 'approve', data.note);
          if (action[2] === 'ask') value = runtime.engine.ask(id, String(data.text ?? ''));
          if (action[2] === 'stop') value = runtime.engine.stopTicket(id, data.reason);
          if (action[2] === 'retry') value = runtime.engine.retryTicket(id);
          if (action[2] === 'action') value = await runtime.armAction(id, data.action, data.payload);
          send(res, 200, value); return;
        }
        if (path === '/api/workflows') {
          const nodes: WorkNode[] = data.demo ? [
            { id: 'api', name: 'Define v2 API', repository: 'backend', request: scenarios.backend.title, scenario: 'backend', role: 'implementer', dependsOn: [], files: ['src/api.js'] },
            { id: 'client', name: 'Update client', repository: 'client', request: scenarios.client.title, scenario: 'client', role: 'implementer', dependsOn: ['api'], files: ['src/client.js'] },
          ] : data.nodes;
          send(res, 201, runtime.workflows.create(data.title ?? 'Cross-repository contract migration', nodes)); return;
        }
        if (path === '/api/knowledge/index') { const id = String(data.repository); const repo = runtime.settings.current.repositories[id]; if (!repo) throw new Error('Unknown repository'); send(res, 200, await runtime.knowledge.index(id, repo.path)); return; }
        if (path === '/api/benchmarks') {
          const models = data.live ? runtime.settings.current.models.filter(m => m.provider !== 'demo') : undefined;
          if (models && !models.length) throw new Error('Configure a real model route before requesting a live benchmark');
          const id = randomUUID(); runtime.store.save('benchmark', id, { id, status: 'running', at: new Date().toISOString() });
          const job = runBenchmark(join(runtime.stateDir, 'benchmarks', id), { models }).then(report => { runtime.store.save('benchmark', id, { ...report, id, status: 'completed' }); }).catch(e => { runtime.store.save('benchmark', id, { id, status: 'failed', error: String(e) }); });
          runtime.track(job); send(res, 202, { id }); return;
        }
        if (path === '/api/skills/propose') { send(res, 201, runtime.skills.propose(runtime.engine.require(String(data.ticketId)), data.name)); return; }
        if (path === '/api/skills/validate') {
          const skill = await runtime.skills.validate(String(data.id), async instructions => { const report = await runBenchmark(join(runtime.stateDir, 'skill-trials', randomUUID()), { cases: [{ id: 'holdout-pagination', scenario: 'pagination', expected: 'delivered' }, { id: 'holdout-slug', scenario: 'slug', expected: 'delivered' }], skillInstructions: instructions }); return { taskIds: report.rows.map(r => r.ticketId), total: report.total, passed: report.verified, regressions: report.regressions }; }); send(res, 200, skill); return;
        }
        if (path === '/api/settings') { const old = runtime.settings.current; await runtime.settings.save(data.value, Number(data.revision)); send(res, 200, { revision: runtime.settings.revision, needsRestart: old.executor.sandbox !== runtime.settings.current.executor.sandbox || JSON.stringify(old.sources) !== JSON.stringify(runtime.settings.current.sources) }); return; }
        if (path === '/api/plugins') { send(res, 201, await runtime.plugins.install(String(data.path))); return; }
      }
      send(res, 404, { error: 'No such route' });
    } catch (err) { const e = err as { code?: string; message?: string }; send(res, e.code?.startsWith('unknown') ? 404 : 400, { error: e.message ?? String(err), code: e.code }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 3082, host, () => resolve()); });
  const address = server.address() as { port: number }; const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`;
  await writeFile(join(runtime.stateDir, 'server.json'), JSON.stringify({ url, pid: process.pid })); runtime.start();
  return { server, url, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await runtime.close(); await unlink(join(runtime.stateDir, 'server.json')).catch(() => {}); } };
}
