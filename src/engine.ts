import { randomUUID } from 'node:crypto';
import type { Store, Ticket, Trigger, Thread, Report, Assignment, Decision, Approval, VerificationResult } from './core/ports.ts';
import type { MegatronSettings } from './policy.ts';
import { settingsPolicy, sourceAllows } from './policy.ts';
import { key } from './core/ids.ts';
import { UserError } from './core/errors.ts';
import { ticketStage } from './core/stage.ts';
import { hasGreenEvidence, latestAssignment } from './core/model.ts';
import type { Outbox } from './outbox.ts';
import type { Ledger } from './ledger.ts';

/** Single aggregate writer. Commands transact facts and queue external effects. */
export class Engine {
  readonly store: Store; readonly settings: () => MegatronSettings; readonly outbox: Outbox; readonly ledger: Ledger; readonly cancel: (id: string) => void;
  constructor(store: Store, settings: () => MegatronSettings, outbox: Outbox, ledger: Ledger, cancel: (id: string) => void = () => {}) { this.store = store; this.settings = settings; this.outbox = outbox; this.ledger = ledger; this.cancel = cancel; }
  require(id: string) { const t = this.store.tickets.get(id); if (!t) throw new UserError('unknownTicket', { ticketId: id }); return t; }
  private save(t: Ticket) { t.stage = ticketStage(t); t.updatedAt = new Date().toISOString(); this.store.tickets.save(t); }
  private event(type: string, t: Ticket, data: Record<string, unknown> = {}) { this.store.events.append(type, { ticketId: t.id, ...data }); }
  private invalidate(t: Ticket) {
    t.verifiedFingerprint = undefined; t.verificationRun = undefined;
    for (const a of t.approvals) if (a.status === 'pending' || a.status === 'approved') { a.status = 'expired'; this.store.save('approval', a.id, a); }
  }
  receive(trigger: Trigger): 'stored' | 'duplicate' | 'fanout' {
    if (!trigger.id || !trigger.text || !trigger.threads.length) throw new UserError('badConfig', { detail: 'Invalid trigger' });
    return this.store.atomic(() => {
      if (this.store.triggers.get(trigger.id)) return 'duplicate';
      this.store.triggers.save(trigger);
      const policy = settingsPolicy(this.settings()); let owned = false;
      const authorized = trigger.human && sourceAllows(this.settings(),trigger.source,trigger.actor.id);
      for (const ref of trigger.threads) {
        const thread = this.store.threads.get(ref) ?? { key: ref, source: trigger.source, id: ref.slice(trigger.source.length + 1), triggers: [], queued: [], decisions: [], subscriptions: [] };
        thread.triggers.push(trigger.id);
        for (const sub of thread.subscriptions) {
          const t = this.store.tickets.get(sub.ticketId); if (!t || t.mandate.stopped) continue;
          if (t.state === 'ended' && (!authorized || sub.context || !policy.revalidate(t.mandate))) continue;
          if (authorized && !sub.context && /^\s*(stop|cancel)\b/i.test(trigger.text)) { this.stopTicket(t.id); owned = true; continue; }
          if (t.state === 'ended') this.resume(t);
          const input = { id: key('input', trigger.id, t.id), kind: 'trigger' as const, triggerId: trigger.id, text: trigger.text, human: trigger.human };
          if (!t.inputs.some(i => i.id === input.id)) t.inputs.push(input);
          if (authorized && !sub.context) {
            this.ledger.humanInput(t.id); t.attention = undefined;
            if (['blocked', 'failed', 'ready'].includes(latestAssignment(t)?.report?.state ?? '')) { this.invalidate(t); this.newAssignment(t, true); }
          }
          this.save(t);
          if (authorized || !t.attention) this.store.effects.enqueue('launch', t.id, { ticketId: t.id });
          if (!sub.context) owned = true;
        }
        if (ref === trigger.threads[0] && !owned) thread.queued.push(trigger.id);
        this.store.threads.save(thread);
      }
      this.store.events.append('trigger.received', { triggerId: trigger.id, source: trigger.source, fanout: owned });
      return owned ? 'fanout' : 'stored';
    });
  }
  evaluateDue() {
    const policy = settingsPolicy(this.settings()); if (policy.paused) return;
    for (const current of this.store.threads.active()) this.store.atomic(() => {
      const t = this.store.threads.get(current.key)!;
      if (t.eval && t.eval.version !== policy.version) { t.queued.unshift(...t.eval.triggerIds); t.eval = undefined; }
      if (t.eval) {
        if ((t.eval.deadline ?? Infinity) > Date.now()) return;
        if (++t.eval.attempts < 3) { t.eval.deadline = Date.now() + 90000; this.store.effects.enqueue('assess', t.eval.id, { threadKey: t.key, evalId: t.eval.id }); }
        else { for (const id of t.eval.triggerIds) this.record(t, id, 'unavailable', 'Assessment timed out'); t.eval = undefined; }
      } else if (t.queued.length) {
        const ids = t.queued.splice(0); const candidate = this.store.triggers.get(ids[0])!;
        const gate = policy.gate(candidate);
        if (!gate.admissible) for (const id of ids) this.record(t, id, 'ignore', gate.reason);
        else {
          t.eval = { id: key('eval', t.key, ids.join(','), policy.version), triggerIds: ids, state: 'assessing', version: policy.version, attempts: 0, deadline: Date.now() + 90000 };
          this.store.effects.enqueue('assess', t.eval.id, { threadKey: t.key, evalId: t.eval.id });
          this.store.events.append('eval.started', { threadKey: t.key, evalId: t.eval.id });
        }
      }
      this.store.threads.save(t);
    });
  }
  decide(threadKey: string, evalId: string, outcome: { kind: 'accept' | 'ignore' | 'unavailable'; reason: string; title?: string; rules?: string[] }) {
    return this.store.atomic(() => {
      const thread = this.store.threads.get(threadKey); if (!thread?.eval || thread.eval.id !== evalId) return;
      const policy = settingsPolicy(this.settings()); if (thread.eval.version !== policy.version) return;
      const trigger = this.store.triggers.get(thread.eval.triggerIds[0])!;
      const gate = policy.gate(trigger);
      if (!gate.admissible || outcome.kind !== 'accept') {
        this.record(thread, trigger.id, gate.admissible ? outcome.kind as 'ignore' | 'unavailable' : 'ignore', gate.admissible ? outcome.reason : gate.reason);
      } else {
        const rules = outcome.rules ?? [];
        const validRules = rules.length && rules.every(id => this.settings().policy.rules.some(r => r.id === id));
        if (gate.strength === 'inferred' && (!validRules || policy.acceptMode === 'observe')) {
          this.record(thread, trigger.id, 'ignore', validRules ? 'Observe mode: would accept' : 'No enabled rule matched', undefined, { wouldAccept: !!validRules });
        } else {
          const repository = String(trigger.meta.repository ?? ''); const repo = this.settings().repositories[repository];
          if (!repo?.verify.length) this.record(thread, trigger.id, 'unavailable', 'Select a configured repository with verification commands');
          else {
            const id = key('ticket', trigger.id);
            let ticket = this.store.tickets.get(id);
            if (!ticket) {
              const now = new Date().toISOString();
              ticket = {
                id, title: (outcome.title ?? trigger.text.split('\n')[0]).slice(0, 120), shortName: `${(outcome.title ?? trigger.text).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${id.slice(0, 6)}`,
                repository, channel: trigger.channel, state: 'open', stage: 'queued', threadKey,
                mandate: { policyVersion: policy.version, scope: repository, strength: gate.strength, basis: gate.basis, sender: trigger.actor.id, source: trigger.source, rules, request: trigger.text },
                criteria: structuredClone(repo.verify).map(c => ({ ...c, regression: ['tester', 'reviewer', 'integrator'].includes(String(trigger.meta.role ?? '')) && ['local', 'demo'].includes(trigger.source) ? false : c.regression })), assignments: [{ id: key('assignment', id, 1), state: 'pending' }],
                inputs: [{ id: key('input', trigger.id, id), kind: 'trigger', triggerId: trigger.id, text: trigger.text, human: trigger.human }],
                evidence: [], approvals: [], createdAt: now, updatedAt: now,
                scenario: trigger.source === 'demo' ? String(trigger.meta.scenario ?? '') : undefined,
                workflowId: trigger.source === 'demo' || trigger.source === 'local' ? trigger.meta.workflowId as string | undefined : undefined,
              };
              this.save(ticket); thread.subscriptions.push({ ticketId: id });
              this.store.effects.enqueue('launch', id, { ticketId: id });
              this.outbox.send({ id: key('ack', trigger.id), ticketId: id, channel: trigger.channel, kind: 'acknowledgement', urgent: true, text: `MEGATRON is working on ${ticket.title}. (${id})` });
              this.event('ticket.created', ticket, { triggerId: trigger.id, repository });
            }
            this.record(thread, trigger.id, 'accept', outcome.reason, id);
          }
        }
      }
      thread.eval = undefined; this.store.threads.save(thread);
    });
  }
  private record(thread: Thread, triggerId: string, kind: Decision['kind'], reason: string, ticketId?: string, audit?: Record<string, unknown>) {
    const d: Decision = { id: key('decision', triggerId, thread.eval?.id, kind), triggerId, evalId: thread.eval?.id, kind, reason, ticketId, audit: { threadKey: thread.key, ...audit }, at: new Date().toISOString() };
    this.store.decisions.save(d); if (!thread.decisions.includes(d.id)) thread.decisions.push(d.id);
    this.store.events.append('decision.recorded', { decisionId: d.id, ticketId, kind, reason });
  }
  assignmentStarted(ticketId: string, assignmentId: string) {
    this.store.atomic(() => { const t = this.require(ticketId); const a = t.assignments.find(a => a.id === assignmentId); if (t.state === 'ended' || !a || a.state === 'ended') return; a.state = 'running'; a.startedAt ??= new Date().toISOString(); for (const i of t.inputs) if (!i.readAt) i.deliveredAt = i.readAt = new Date().toISOString(); this.save(t); this.event('assignment.started', t, { assignmentId }); });
  }
  checkpoint(ticketId: string, value: Assignment['checkpoint']) { this.store.atomic(() => { const t = this.require(ticketId); const a = latestAssignment(t); if (a && t.state === 'open') { a.checkpoint = value; this.store.setValue(`checkpoint:${ticketId}`, value); this.save(t); this.event('checkpoint.saved', t, { step: value?.step }); } }); }
  report(ticketId: string, report: Report) {
    return this.store.atomic(() => {
      const t = this.require(ticketId); const a = latestAssignment(t);
      if (t.state !== 'open') throw new UserError('ticketEnded');
      if (!a || a.state !== 'running' || !report.summary || !['progress', 'ready', 'blocked', 'failed', 'dropped'].includes(report.state) || (report.state === 'ready' && report.question)) throw new UserError('invalidReport');
      a.report = report; if (report.checkpoint) { a.checkpoint = report.checkpoint; this.store.setValue(`checkpoint:${ticketId}`, report.checkpoint); }
      if (report.question && report.question !== t.attention?.question) {
        if (t.attention) this.outbox.withdraw(t.attention.id);
        t.attention = { id: randomUUID(), question: report.question, askedAt: new Date().toISOString() }; this.ledger.attention(t.id, t.attention.id);
        this.outbox.send({ id: t.attention.id, ticketId: t.id, channel: t.channel, text: report.question.slice(0, 1000), kind: 'reply', urgent: true });
      } else if (report.question === null || report.state === 'ready') t.attention = undefined;
      if (['blocked','failed'].includes(report.state) && !report.question) {
        this.ledger.attention(t.id, `${a.id}:${report.state}`);
        this.outbox.send({ id: key('blocked-notice',a.id,report.state), ticketId:t.id, channel:t.channel, text:report.summary.slice(0,1000), kind:'notice', urgent:true });
      }
      if (report.state === 'ready') { this.invalidate(t); this.store.effects.enqueue('verify', `${t.id}:${a.id}`, { ticketId: t.id, assignmentId: a.id }); }
      if (report.state === 'dropped') this.end(t, 'executor', 'dropped', report.summary); else this.save(t);
      this.event('report.recorded', t, { state: report.state, summary: report.summary }); return this.require(t.id);
    });
  }
  evidenceResult(ticketId: string, result: VerificationResult, assignmentId: string) {
    this.store.atomic(() => {
      const t = this.require(ticketId); const a = latestAssignment(t);
      if (t.state !== 'open' || a?.id !== assignmentId || a.report?.state !== 'ready') return;
      t.evidence.push(...result.receipts); t.verificationRun = result.runId;
      const allPass = t.criteria.length > 0 && t.criteria.every(c => result.receipts.some(e => e.criterion === c.id && e.status === 'pass')) && result.receipts.every(e => e.status === 'pass');
      for (const e of result.receipts) this.store.save('evidence', e.id, e);
      if (!allPass) {
        this.invalidate(t); t.verificationRun = result.runId;
        a.report = { state: 'blocked', summary: 'Verification failed. Review the failed evidence and retry with a correction.', at: new Date().toISOString() };
        this.save(t); this.event('evidence.failed', t, { runId: result.runId });
        if (t.assignments.length > this.settings().executor.retryLimit || t.attention) { this.ledger.attention(t.id,`verification-blocked:${a.id}`); this.outbox.send({ id:key('verification-blocked',a.id),ticketId: t.id, channel: t.channel, text: a.report.summary, kind: 'notice', urgent: true }); } return;
      }
      t.verifiedFingerprint = result.fingerprint;
      this.event('evidence.passed', t, { runId: result.runId, fingerprint: result.fingerprint });
      if (this.settings().policy.gates.delivery) {
        this.armGateOn(t, 'delivery', 'Deliver an immutable patch bundle for review');
        this.outbox.send({ ticketId: t.id, channel: t.channel, text: `${t.title}: verification passed. Review and approve the patch bundle. (${t.id})`, kind: 'result', urgent: true });
      } else this.store.effects.enqueue('deliver', t.id, { ticketId: t.id });
      this.save(t);
    });
  }
  private armGateOn(t: Ticket, kind: Approval['kind'], summary: string, payload?: Record<string, unknown>) {
    if (!hasGreenEvidence(t)) throw new UserError('evidenceFailed');
    const a: Approval = { id: randomUUID(), ticketId: t.id, kind, summary, risk: kind === 'delivery' ? 'low' : 'medium', fingerprint: t.verifiedFingerprint!, status: 'pending', expiresAt: new Date(Date.now() + 86400000).toISOString(), payload };
    t.approvals.push(a); this.store.save('approval', a.id, a); this.ledger.attention(t.id, a.id); this.event('approval.created', t, { approvalId: a.id, kind }); return a;
  }
  armGate(ticketId: string, kind: Approval['kind'], summary: string, payload?: Record<string, unknown>) { return this.store.atomic(() => { const t = this.require(ticketId); const a = this.armGateOn(t, kind, summary, payload); this.save(t); return a; }); }
  decideApproval(ticketId: string, approvalId: string, approve: boolean, by: string, note = '') {
    const snapshot = this.require(ticketId); const gate = snapshot.approvals.find(a => a.id === approvalId);
    if (gate && (Date.parse(gate.expiresAt) <= Date.now() || gate.fingerprint !== snapshot.verifiedFingerprint)) {
      this.store.atomic(() => { gate.status = 'expired'; this.store.save('approval', gate.id, gate); this.save(snapshot); });
      throw new UserError('evidenceFailed');
    }
    return this.store.atomic(() => {
      const t = this.require(ticketId); const a = t.approvals.find(a => a.id === approvalId);
      if (!this.settings().policy.allowed.includes(by)) throw new UserError('notAllowed');
      if (!a || a.status !== 'pending') throw new UserError('unknownApproval');
      if (Date.parse(a.expiresAt) <= Date.now() || a.fingerprint !== t.verifiedFingerprint) { a.status = 'expired'; this.store.save('approval', a.id, a); this.save(t); throw new UserError('evidenceFailed'); }
      a.status = approve ? 'approved' : 'denied'; a.decidedBy = by; a.decidedAt = new Date().toISOString(); this.store.save('approval', a.id, a);
      this.ledger.humanInput(t.id); this.event('approval.decided', t, { approvalId, approve, by });
      if (approve) this.store.effects.enqueue(a.kind === 'delivery' ? 'deliver' : 'approved-action', a.id, { ticketId, approvalId });
      else { this.invalidate(t); t.inputs.push({ id: randomUUID(), kind: 'note', human: true, text: note || 'The reviewer requested changes. Review the request and revise.' }); this.newAssignment(t, true); this.store.effects.enqueue('launch', t.id, { ticketId: t.id }); }
      this.save(t); return a;
    });
  }
  deliveryDone(ticketId: string, delivery: Ticket['delivery']) { this.store.atomic(() => { const t = this.require(ticketId); if (!delivery || delivery.fingerprint !== t.verifiedFingerprint) throw new UserError('evidenceFailed'); t.delivery = delivery; this.end(t, 'executor', 'delivered', 'Immutable patch bundle created'); this.outbox.send({ ticketId: t.id, channel: t.channel, text: `${t.title}: patch bundle delivered with verification receipts. (${t.id})`, kind: 'result', urgent: true }); }); }
  deliveryFailed(ticketId: string, message: string) { this.store.atomic(() => { const t = this.require(ticketId); this.invalidate(t); const a = latestAssignment(t)!; a.report = { state: 'blocked', summary: message, at: new Date().toISOString() }; this.save(t); this.event('delivery.failed', t, { message }); }); }
  ask(ticketId: string, text: string, by = 'operator') {
    return this.store.atomic(() => {
      if (!this.settings().policy.allowed.includes(by)) throw new UserError('notAllowed');
      const t = this.require(ticketId); if (!settingsPolicy(this.settings()).revalidate(t.mandate)) throw new UserError('ticketStopped');
      if (t.state === 'ended') this.resume(t); else if (['blocked', 'failed', 'ready'].includes(latestAssignment(t)?.report?.state ?? '')) { this.newAssignment(t, true); this.store.afterCommit(() => this.cancel(t.id)); }
      this.invalidate(t); t.attention = undefined; this.ledger.humanInput(t.id); t.inputs.push({ id: randomUUID(), kind: 'note', text, human: true }); this.save(t);
      this.store.effects.enqueue('launch', t.id, { ticketId: t.id }); this.event('input.received', t, { by }); return t;
    });
  }
  stopTicket(ticketId: string, reason = 'Stopped by a person') { return this.store.atomic(() => { const t = this.require(ticketId); t.mandate.stopped = true; this.invalidate(t); if (t.state === 'open') this.end(t, 'person', 'stopped', reason); else this.save(t); this.store.afterCommit(() => this.cancel(t.id)); this.event('mandate.withdrawn', t); return t; }); }
  retryTicket(ticketId: string) { return this.store.atomic(() => { const t = this.require(ticketId); if (t.state !== 'open' || !['needs-you', 'waiting'].includes(t.stage)) throw new UserError('nothingToRetry'); this.invalidate(t); this.newAssignment(t, true); t.attention = undefined; this.save(t); this.store.afterCommit(() => this.cancel(t.id)); this.store.effects.enqueue('launch', t.id, { ticketId: t.id }); this.event('ticket.retried', t); return t; }); }
  continueAfterFailure(ticketId: string) {
    const t = this.require(ticketId); if (t.attention || latestAssignment(t)?.report?.state !== 'blocked' || t.assignments.length > this.settings().executor.retryLimit) return;
    t.inputs.push({ id: randomUUID(), kind: 'note', text: `Independent verification failed. Investigate the counterexample and correct the implementation. Latest evidence: ${t.evidence.filter(e => e.runId === t.verificationRun).map(e => e.output).join('\n').slice(-8000)}` });
    this.store.tickets.save(t); this.retryTicket(t.id);
  }
  private newAssignment(t: Ticket, interrupted = false) { const old = latestAssignment(t); if (old) { old.state = 'ended'; old.endedAt = new Date().toISOString(); } t.assignments.push({ id: key('assignment', t.id, t.assignments.length + 1), state: 'pending', interrupted }); }
  private resume(t: Ticket) { t.state = 'open'; t.ended = undefined; this.newAssignment(t, true); this.event('ticket.resumed', t); }
  end(t: Ticket, by: string, outcome: NonNullable<Ticket['ended']>['outcome'], reason: string) { t.state = 'ended'; t.ended = { by, outcome, reason, at: new Date().toISOString() }; const a = latestAssignment(t); if (a) { a.state = 'ended'; a.endedAt = t.ended.at; } this.save(t); this.event('ticket.ended', t, { outcome }); }
  recover() {
    this.store.atomic(() => { this.store.effects.recover(); for (const t of this.store.tickets.open()) { const a = latestAssignment(t); if (a?.state !== 'running' || ['ready', 'blocked', 'failed'].includes(a.report?.state ?? '') || t.attention) continue; a.state = 'pending'; a.interrupted = true; this.save(t); this.store.effects.enqueue('launch', t.id, { ticketId: t.id }); this.event('assignment.recovered', t, { assignmentId: a.id }); } });
  }
}
