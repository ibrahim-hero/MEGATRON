import { randomUUID } from 'node:crypto';
import type { Store, Ticket } from '../core/ports.ts';
export interface Skill {
  id: string; name: string; version: number; status: 'candidate' | 'published' | 'rejected'; instructions: string;
  provenance: { ticketId: string; fingerprint: string }; validation?: { tasks: string[]; total: number; passed: number; regressions: number; baselinePassed: number; at: string }; createdAt: string;
}
export interface SkillTrial { taskIds: string[]; total: number; passed: number; regressions: number }
export class SkillLibrary {
  store: Store;
  constructor(store: Store) { this.store = store; }
  propose(t: Ticket, name?: string) {
    if (!t.verifiedFingerprint || !t.delivery) throw new Error('A skill must originate from a verified delivery');
    const previous = this.store.list<Skill>('skill').filter(s => s.name === (name ?? t.title));
    const skill: Skill = { id: randomUUID(), name: name ?? t.title, version: previous.length + 1, status: 'candidate', instructions: `For work like "${t.title}":\n1. Reproduce the symptom before editing.\n2. Inspect referenced files and dependency impact.\n3. Preserve trusted acceptance checks.\n4. Verify with ${t.criteria.map(c => c.command).join(' and ')}.\n5. Report measured results and create a checkpoint.`, provenance: { ticketId: t.id, fingerprint: t.verifiedFingerprint }, createdAt: new Date().toISOString() };
    this.store.save('skill', skill.id, skill); return skill;
  }
  async validate(id: string, trial: (instructions: string) => Promise<SkillTrial>) {
    const skill = this.store.get<Skill>('skill', id); if (!skill) throw new Error('Unknown skill');
    const baseline = await trial(''); const candidate = await trial(skill.instructions);
    const clean = candidate.total >= 2 && candidate.taskIds.length === candidate.total && new Set(candidate.taskIds).size === candidate.total && candidate.taskIds.every(id => id !== skill.provenance.ticketId) && candidate.regressions === 0 && candidate.passed >= baseline.passed;
    skill.status = clean ? 'published' : 'rejected'; skill.validation = { tasks: candidate.taskIds, total: candidate.total, passed: candidate.passed, regressions: candidate.regressions, baselinePassed: baseline.passed, at: new Date().toISOString() }; this.store.save('skill', skill.id, skill); return skill;
  }
  context(query: string) { const words = query.toLowerCase().split(/\W+/); return this.store.list<Skill>('skill').filter(s => s.status === 'published' && words.some(w => w.length > 3 && s.name.toLowerCase().includes(w))).slice(-3).map(s => s.instructions).join('\n\n'); }
}
