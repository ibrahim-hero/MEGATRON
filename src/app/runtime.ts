import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../store/store.ts';
import { SettingsManager } from './settings.ts';
import { validateSettings, settingsPolicy, DEFAULT_SETTINGS, type MegatronSettings } from '../policy.ts';
import { Effects, Later } from '../effects.ts';
import { Outbox } from '../outbox.ts';
import { Ledger } from '../ledger.ts';
import { Engine } from '../engine.ts';
import { createSandbox } from '../sandbox/sandbox.ts';
import { EvidenceService } from '../evidence.ts';
import { KnowledgeIndex } from '../knowledge/index.ts';
import { SkillLibrary } from '../skills/learning.ts';
import { WorkflowService, type WorkNode, type Workflow } from '../workflows/dag.ts';
import { PluginRegistry } from '../plugins/registry.ts';
import { McpClient } from '../plugins/mcp.ts';
import { ModelRouter } from './model-router.ts';
import { ScriptedProvider, HttpProvider } from '../llm/providers.ts';
import { MegatronExecutor } from '../executor/executor.ts';
import { SourceRegistry, FileChannel } from '../sources/registry.ts';
import { GithubSource, GithubDelivery, ghTransport } from '../sources/github.ts';
import { FeishuChannel } from '../sources/feishu.ts';
import { scenarios, scenarioSteps } from '../bench/scenarios.ts';
import { key } from '../core/ids.ts';
import type { Ticket, Trigger, Sandbox, Approval } from '../core/ports.ts';
import { fingerprint, safePath } from '../infra/files.ts';

export function demoSettings(): MegatronSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const scenario of Object.values(scenarios)) s.repositories[scenario.repository] = { path: scenario.root, verify: [{ id: scenario.id, label: scenario.title, command: `node --test ${scenario.test}`, timeoutMs: 30000, regression: true }], trustedTests: [scenario.test, 'package.json'] };
  return s;
}
export class Runtime {
  stateDir: string; store: SqliteStore; settings: SettingsManager; effects: Effects; ledger: Ledger;
  outbox: Outbox; engine: Engine; sandbox: Sandbox; evidence: EvidenceService; knowledge: KnowledgeIndex;
  skills: SkillLibrary; workflows: WorkflowService; plugins: PluginRegistry; router: ModelRouter; executor: MegatronExecutor;
  sources = new SourceRegistry(); private github?: GithubSource; private timer?: NodeJS.Timeout; private busy = false; private closed = false; private lastPoll = 0;
  private jobs = new Set<Promise<unknown>>();
  private constructor(stateDir: string, store: SqliteStore, settings: SettingsManager) {
    this.stateDir = stateDir; this.store = store; this.settings = settings;
    this.ledger = new Ledger(store); this.effects = new Effects(store);
    const getSettings = () => this.settings.current;
    this.outbox = new Outbox(store, this.sources.senders, getSettings, this.ledger);
    this.engine = new Engine(store, getSettings, this.outbox, this.ledger, id => this.executor?.cancel(id));
    this.sandbox = createSandbox(settings.current.executor.sandbox, settings.current.executor.blockedCommands, settings.current.executor.image);
    this.knowledge = new KnowledgeIndex(store); this.skills = new SkillLibrary(store); this.plugins = new PluginRegistry(store); this.router = new ModelRouter(store, () => this.settings.current.models);
    this.evidence = new EvidenceService(store, this.sandbox, getSettings, t => join(stateDir, 'baselines', t.id));
    this.executor = new MegatronExecutor({ store, engine: this.engine, effects: this.effects, sandbox: this.sandbox, settings: getSettings, ledger: this.ledger, evidence: this.evidence, knowledge: this.knowledge, skills: this.skills, plugins: this.plugins, router: this.router, stateDir,
      source: t => this.store.get<{ path: string }>('task-source', t.id)?.path ?? this.settings.current.repositories[t.repository].path,
      provider: t => {
        const excluded = this.store.get<string[]>('failed-models', t.id) ?? [];
        const model = this.router.choose(['tools'], [...excluded, ...(!t.scenario ? this.settings.current.models.filter(m => m.provider === 'demo').map(m => m.id) : [])]);
        if (model.provider === 'demo') {
          if (!t.scenario) throw new Error('This is a real task: configure an OpenAI-compatible or Anthropic provider before running it.');
          const answered = t.scenario === 'question' && t.inputs.some(i => i.kind === 'note' && i.human);
          return { provider: new ScriptedProvider(scenarioSteps(t.scenario === 'speculation' ? 'shop' : answered ? 'backend' : t.scenario)), model };
        }
        return { provider: new HttpProvider(model), model };
      },
    });
    this.workflows = new WorkflowService(store, (n, workflowId) => {
      const w = store.get<Workflow>('workflow', workflowId);
      const deps = w?.nodes.filter(p => n.dependsOn.includes(p.id));
      const artifacts = deps?.flatMap(p => p.artifacts ?? []) ?? [];
      const id = this.submit(`${n.request}\nRole: ${n.role}\nDependency artifacts: ${artifacts.join(', ')}`, { repository: n.repository, scenario: n.scenario, workflowId, role: n.role });
      const previous = deps?.map(p => p.ticketId && store.tickets.get(p.ticketId)).find(t => t && t.repository === n.repository && t.delivery);
      if (previous && previous.delivery) store.save('task-source', id, { path: join(previous.delivery.directory, 'workspace') });
      store.save('file-contract', id, n.files); return id;
    });
    this.effects.handle('assess', async row => {
      if (getSettings().policy.paused) throw new Later('Processing paused', 1000);
      const { threadKey, evalId } = row.payload as { threadKey: string; evalId: string };
      const thread = store.threads.get(threadKey); if (thread?.eval?.id !== evalId) return;
      const trigger = store.triggers.get(thread.eval.triggerIds[0])!;
      const gate = settingsPolicy(getSettings()).gate(trigger);
      const explicit = gate.admissible && gate.strength === 'explicit';
      const rules = explicit ? [] : getSettings().policy.rules.filter(r => /fail|bug|fix|test|incident/i.test(trigger.text)).map(r => r.id);
      this.engine.decide(threadKey, evalId, { kind: 'accept', title: String(trigger.meta.title ?? trigger.text.split('\n')[0]), reason: explicit ? 'Authorized direct request' : 'Candidate matched configured proactive rules', rules });
    });
    this.effects.handle('launch', async row => this.executor.launch((row.payload as { ticketId: string }).ticketId));
    this.effects.handle('verify', async row => { const p = row.payload as { ticketId: string; assignmentId: string }; if (getSettings().policy.paused) throw new Later('Processing paused', 1000); await this.executor.verify(p.ticketId, p.assignmentId); });
    this.effects.handle('deliver', async row => { if (getSettings().policy.paused) throw new Later('Processing paused', 1000); await this.executor.deliver((row.payload as { ticketId: string }).ticketId); });
    this.effects.handle('reply', async row => { if (getSettings().policy.paused) throw new Later('Processing paused', 1000); await this.outbox.flushOne((row.payload as { id: string }).id); });
    this.effects.handle('approved-action', async row => { const p = row.payload as { ticketId: string; approvalId: string }; await this.performAction(p.ticketId, p.approvalId); });
    this.sources.register('local', new FileChannel(join(stateDir, 'messages'))); this.sources.register('demo', new FileChannel(join(stateDir, 'messages')));
    if (settings.current.sources.github) {
      const cfg = settings.current.sources.github; this.github = new GithubSource(store, cfg, ghTransport(stateDir, cfg.cli)); this.sources.register('github', this.github);
    }
    if (settings.current.sources.feishu) this.sources.register('feishu', new FeishuChannel(settings.current.sources.feishu));
  }
  static async create(options: { stateDir: string; settings?: MegatronSettings }) {
    const dir = resolve(options.stateDir); await mkdir(dir, { recursive: true }); const lock = join(dir, 'runtime.lock');
    if (existsSync(lock)) { const old = JSON.parse(await readFile(lock, 'utf8')); let alive = false; try { process.kill(old.pid, 0); alive = true; } catch {} if (alive) throw new Error('MEGATRON is already running for this state directory. Use its API or stop that process.'); await unlink(lock); }
    const file = await open(lock, 'wx'); await file.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await file.close();
    let store: SqliteStore | undefined;
    try {
      store = new SqliteStore(join(dir, 'megatron.sqlite')); const settings = await SettingsManager.load(store, dir, options.settings);
      const r = new Runtime(dir, store, settings); r.engine.recover();
      for (const [id, repo] of Object.entries(settings.current.repositories)) { if (!existsSync(repo.path)) throw new Error(`Configured repository ${id} does not exist: ${repo.path}`); await r.knowledge.index(id, repo.path); }
      for (const p of store.list<{ id: string; enabled: boolean }>('plugin')) if (p.enabled) await r.plugins.load(p.id);
      for (const mcp of settings.current.mcp.filter(m => m.enabled)) await r.plugins.addMcp(new McpClient(mcp, dir));
      return r;
    } catch (err) { store?.close(); await unlink(lock).catch(() => {}); throw err; }
  }
  submit(text: string, opts: { repository: string; scenario?: string; workflowId?: string; role?: string; actor?: string; title?: string } ) {
    if (!text.trim() || !this.settings.current.repositories[opts.repository]) throw new Error('Choose a configured repository and describe the request');
    const id = randomUUID(); const source = opts.scenario ? 'demo' : 'local'; const thread = `${source}:${id}`;
    const trigger: Trigger = { id, source, threads: [thread], human: true, addressed: 'direct', actor: { source, id: opts.actor ?? 'operator' }, at: new Date().toISOString(), text, channel: { source, thread, address: { conversation: id } }, meta: { repository: opts.repository, scenario: opts.scenario, workflowId: opts.workflowId, role: opts.role, title: opts.title } };
    this.engine.receive(trigger); return key('ticket', id);
  }
  submitDemo(id = 'shop') {
    const scenario = scenarios[id] ?? (id === 'question' ? scenarios.backend : scenarios.shop);
    if (!this.settings.current.repositories[scenario.repository]) throw new Error('Run the demo with demo settings');
    return this.submit(scenario.title, { repository: scenario.repository, scenario: id, title: id === 'liar' ? 'Reject a false-ready report' : id === 'question' ? 'Choose the refund contract' : id === 'speculation' ? 'Compare two checkout-fix hypotheses' : scenario.title });
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      this.engine.evaluateDue(); if (!this.settings.current.policy.paused) this.workflows.tick(this.settings.current.executor.maxWorkers);
      await this.effects.drain(this.settings.current.executor.maxWorkers + 4);
      if (this.github && Date.now() - this.lastPoll > this.github.config.pollSeconds * 1000) {
        this.lastPoll = Date.now(); const repository = Object.entries(this.settings.current.repositories).find(([, r]) => r.github === this.github!.config.repository)?.[0];
        if (repository) { try { await this.github.poll(t => this.engine.receive(t), repository); this.sources.success('github'); } catch (e) { this.sources.failure('github', e); } }
      }
    } finally { this.busy = false; }
  }
  start() { if (!this.timer) this.timer = setInterval(() => { this.tick().catch(e => this.store.events.append('runtime.error', { error: String(e) })); }, 250); }
  track(job: Promise<unknown>) { this.jobs.add(job); job.finally(() => this.jobs.delete(job)).catch(() => {}); }
  async waitTicket(id: string, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.tick(); const t = this.store.tickets.get(id);
      if (t && (t.state === 'ended' || t.stage === 'needs-you' || t.stage === 'waiting')) {
        for (const message of this.store.outbox.pending().filter(m=>m.ticketId===id)) { try { await this.outbox.flushOne(message.id); } catch (e) { if(!(e instanceof Later))this.store.events.append('message.deferred',{ticketId:id,error:String(e)}); } }
        return this.engine.require(id);
      }
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('Task is still running; inspect its persisted timeline or resume later');
  }
  async approve(ticketId: string, approvalId?: string, yes = true, note = '') {
    const t = this.engine.require(ticketId); const a = t.approvals.find(a => a.status === 'pending' && (!approvalId || a.id === approvalId)); if (!a) throw new Error('No pending approval');
    if (await fingerprint(this.executor.workspace(t)) !== a.fingerprint) { this.engine.deliveryFailed(t.id, 'Workspace changed since verification; approve is invalid until checks are rerun.'); throw new Error('Stale verification: review and re-verify the new tree'); }
    return this.engine.decideApproval(t.id, a.id, yes, 'operator', note);
  }
  async armAction(ticketId: string, action: 'apply' | 'publish-pr' | 'merge' | 'deploy', payload: Record<string, unknown> = {}) {
    const t = this.engine.require(ticketId); if (!t.delivery) throw new Error('Deliver and review the verified patch bundle first');
    return this.engine.armGate(t.id, action === 'merge' ? 'merge' : action === 'deploy' ? 'deploy' : 'side-effect', `${action}: ${t.title}`, { action, ...payload });
  }
  private async performAction(ticketId: string, approvalId: string) {
    const t = this.engine.require(ticketId); const approval = t.approvals.find(a => a.id === approvalId); if (approval?.status !== 'approved') return;
    if (!t.delivery || await fingerprint(this.executor.workspace(t)) !== approval.fingerprint) throw new Error('Action cannot run with stale verification');
    const previous = this.store.get('action-receipt', approvalId); if (previous) return;
    const action = approval.payload?.action; let result: unknown;
    if (action === 'apply') {
      const manifest = JSON.parse(await readFile(join(t.delivery.directory, 'manifest.json'), 'utf8'));
      const root = this.settings.current.repositories[t.repository].path;
      if (await fingerprint(root) !== manifest.baselineFingerprint) throw new Error('Repository changed after this task started. Rebase and verify before applying.');
      for (const f of manifest.files) { const path = await safePath(root, f.path); if (f.hash === null) await unlink(path); else { const bytes = await readFile(join(t.delivery.directory, 'workspace', f.path)); const { dirname } = await import('node:path'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); } }
      result = { applied: true, files: manifest.files.length }; await this.knowledge.index(t.repository, root);
    } else if (action === 'publish-pr' || action === 'merge') {
      const repository = this.settings.current.repositories[t.repository]; if (!repository.github) throw new Error('Configure this repository’s GitHub owner/name');
      const delivery = new GithubDelivery(ghTransport(this.stateDir, this.settings.current.sources.github?.cli), this.store);
      if (action === 'merge') result = await delivery.merge(t);
      else { const manifest = JSON.parse(await readFile(join(t.delivery.directory, 'manifest.json'), 'utf8')); const changes = await Promise.all(manifest.files.map(async (f:any)=>({...f,contentBase64:f.hash===null?undefined:(await readFile(join(t.delivery!.directory,'workspace',f.path))).toString('base64')}))); result = await delivery.publish(t, repository.github, changes, repository.baseBranch ?? 'main'); }
    } else if (action === 'deploy') {
      const tool = String(approval.payload?.tool ?? ''); if (!tool) throw new Error('Select an installed deployment integration tool');
      const invoke = async (name: string) => { const output = await this.plugins.call(name, join(t.delivery!.directory, 'workspace'), (approval.payload?.args ?? {}) as Record<string, unknown>); if(!output.ok)throw new Error('Deployment integration failed'); try{return JSON.parse(output.text);}catch{return {healthy:false,output:output.text};} };
      if (approval.payload?.healthTool && approval.payload?.rollbackTool) { const { runRollout } = await import('../executor/rollout.ts'); result = await runRollout(this.store, { id: approvalId, ticketId, deploy: () => invoke(tool), health: () => invoke(String(approval.payload!.healthTool)), rollback: () => invoke(String(approval.payload!.rollbackTool)), maxValue: typeof approval.payload.maxValue === 'number' ? approval.payload.maxValue : undefined }); }
      else result = await invoke(tool);
    } else throw new Error('Unknown action');
    this.store.save('action-receipt', approvalId, { action, result, at: new Date().toISOString() }); this.store.events.append('action.completed', { ticketId, approvalId, action, result });
  }
  overview() {
    const tickets = this.store.tickets.list().slice().reverse(); const needs = tickets.filter(t => t.stage === 'needs-you' || t.approvals.some(a => a.status === 'pending'));
    return { product: 'MEGATRON', version: '1.0.0', mode: this.settings.current.models.every(m => m.provider === 'demo') ? 'demo' : 'live', paused: this.settings.current.policy.paused, tickets, needs, working: tickets.filter(t => ['working', 'queued', 'verifying'].includes(t.stage)), completed: tickets.filter(t => t.ended?.outcome === 'delivered').length, workers: { active: this.executor.activeCount, max: this.settings.current.executor.maxWorkers }, ledger: this.ledger.summary(), sources: this.sources.overview(), effects: this.store.effects.pending().filter(e => e.attempts >= 3).map(e => ({ kind: e.kind, error: e.lastError })), knowledge: { documents: this.store.list('document').length, facts: this.store.list('fact').length }, workflows: this.store.list('workflow') };
  }
  async close() {
    if (this.closed) return; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    for (const t of this.store.tickets.open()) this.executor.cancel(t.id);
    while (this.busy) await new Promise(r => setTimeout(r, 20));
    await Promise.allSettled([...this.jobs]); this.closed = true; await this.plugins.close(); this.store.close(); await unlink(join(this.stateDir, 'runtime.lock')).catch(() => {});
  }
}
