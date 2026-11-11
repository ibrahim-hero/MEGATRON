import { randomUUID } from 'node:crypto';
import type { Store, Ticket } from '../core/ports.ts';
export interface WorkNode {
  id: string; name: string; repository: string; request: string; role: 'implementer' | 'tester' | 'reviewer' | 'integrator';
  dependsOn: string[]; files: string[]; scenario?: string;
  status?: 'queued' | 'running' | 'waiting' | 'done' | 'failed'; ticketId?: string; artifacts?: string[];
}
export interface Workflow { id: string; title: string; nodes: WorkNode[]; status: 'running' | 'waiting' | 'completed' | 'failed'; createdAt: string }
export function validateGraph(nodes: WorkNode[]) {
  const ids = new Set(nodes.map(n => n.id)); if (!nodes.length || ids.size !== nodes.length) throw new Error('Workflows need unique nonempty nodes');
  const visiting = new Set<string>(); const done = new Set<string>();
  const visit = (id: string) => { if (done.has(id)) return; if (visiting.has(id)) throw new Error('Workflow dependency cycle'); visiting.add(id); const n = nodes.find(n => n.id === id)!; for (const dep of n.dependsOn) { if (!ids.has(dep)) throw new Error(`Unknown dependency: ${dep}`); visit(dep); } visiting.delete(id); done.add(id); };
  for (const n of nodes) { if (!n.repository || !n.request || !Array.isArray(n.files)) throw new Error('Every subtask needs a repository, request, and file contract'); visit(n.id); }
}
export function overlap(a: WorkNode, b: WorkNode) {
  if (a.repository !== b.repository) return false;
  const paths = (n: WorkNode) => n.files.length ? n.files : ['*'];
  return paths(a).some(x => paths(b).some(y => x === '*' || y === '*' || x === y || x.startsWith(y.replace(/\*$/, '')) || y.startsWith(x.replace(/\*$/, ''))));
}
export class WorkflowService {
  store: Store; submit: (n: WorkNode, workflowId: string) => string;
  constructor(store: Store, submit: (n: WorkNode, workflowId: string) => string) { this.store = store; this.submit = submit; }
  create(title: string, nodes: WorkNode[]) {
    validateGraph(nodes); const row: Workflow = { id: randomUUID(), title, nodes: nodes.map(n => ({ ...structuredClone(n), status: 'queued' })), status: 'running', createdAt: new Date().toISOString() };
    this.store.save('workflow', row.id, row); return row;
  }
  tick(concurrency = 2) {
    for (const w of this.store.list<Workflow>('workflow').filter(w => w.status !== 'completed')) {
      for (const n of w.nodes.filter(n => n.ticketId)) {
        const t = this.store.tickets.get(n.ticketId!); if (!t) continue;
        if (t.state === 'ended') { n.status = ['delivered', 'completed', 'merged'].includes(t.ended?.outcome ?? '') ? 'done' : 'failed'; n.artifacts = t.delivery ? [t.delivery.directory] : []; }
        else n.status = t.stage === 'needs-you' ? 'waiting' : 'running';
      }
      for (const n of w.nodes.filter(n => n.status === 'queued')) {
        if (!n.dependsOn.every(id => w.nodes.find(p => p.id === id)?.status === 'done')) continue;
        const active = w.nodes.filter(p => p.status === 'running' || p.status === 'waiting');
        if (active.length >= concurrency || active.some(p => overlap(n, p))) continue;
        n.ticketId = this.submit(n, w.id); n.status = 'running';
      }
      w.status = w.nodes.every(n => n.status === 'done') ? 'completed' : w.nodes.some(n => n.status === 'failed') ? 'failed' : w.nodes.some(n => n.status === 'waiting') ? 'waiting' : 'running';
      this.store.save('workflow', w.id, w);
    }
  }
}
