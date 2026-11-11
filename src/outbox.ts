import { randomUUID } from 'node:crypto';
import type { OutboxMessage, Store } from './core/ports.ts';
import type { MegatronSettings } from './policy.ts';
import type { Ledger } from './ledger.ts';
import { Later } from './effects.ts';
export interface ChannelSender { send(msg: OutboxMessage): Promise<'sent' | 'gone' | 'waiting'> }
export class Outbox {
  readonly store: Store; readonly senders: Map<string, ChannelSender>; readonly settings: () => MegatronSettings; readonly ledger: Ledger;
  constructor(store: Store, senders: Map<string, ChannelSender>, settings: () => MegatronSettings, ledger: Ledger) { this.store = store; this.senders = senders; this.settings = settings; this.ledger = ledger; }
  send(input: { id?: string; ticketId?: string; channel: OutboxMessage['channel']; text: string; kind: OutboxMessage['kind']; urgent?: boolean }) {
    return this.store.atomic(() => {
      const id = input.id ?? randomUUID(); const old = this.store.outbox.get(id); if (old) return old;
      const seq = this.store.events.append('message.queued', { ticketId: input.ticketId, messageId: id, kind: input.kind });
      const m: OutboxMessage = { ...input, id, status: 'pending', attempts: 0, createdAt: new Date().toISOString(), queuedSeq: seq };
      this.store.outbox.save(m); this.store.effects.enqueue('reply', id, { id }); return m;
    });
  }
  status(id: string) { return this.store.outbox.get(id)?.status; }
  withdraw(id: string, reason = 'withdrawn') { const m = this.store.outbox.get(id); if (m?.status === 'pending') this.store.outbox.save({ ...m, status: 'dropped', dropReason: reason, settledAt: new Date().toISOString() }); }
  async flushOne(id: string) {
    const m = this.store.outbox.get(id); if (!m || m.status !== 'pending') return;
    const n = this.settings().notifications;
    if (!n.enabled) throw new Later('notifications paused', 1000);
    if (!m.urgent) {
      if (n.quietHours) { const hour = new Date().getHours(); const { from, to } = n.quietHours; if (from < to ? hour >= from && hour < to : hour >= from || hour < to) throw new Later('quiet hours', 60000); }
      const due = new Date(m.createdAt).getTime() + n.digestSeconds * 1000;
      if (due > Date.now()) throw new Later('digest delivery window', due - Date.now());
    }
    if (this.store.outbox.pending().some(p => p.id !== id && p.ticketId === m.ticketId && p.channel.thread === m.channel.thread && p.queuedSeq < m.queuedSeq && p.attempts < 3)) throw new Later('waiting for earlier message');
    const sender = this.senders.get(m.channel.source); if (!sender) throw new Later('source is offline', 1000);
    try {
      const result = await sender.send(m); if (result === 'waiting') throw new Later('source is disabled', 1000);
      this.store.atomic(() => {
        this.store.outbox.save({ ...m, status: result === 'sent' ? 'sent' : 'dropped', settledAt: new Date().toISOString(), dropReason: result === 'gone' ? 'conversation gone' : undefined });
        if (result === 'sent') this.ledger.message(m.ticketId, m.id);
        this.store.events.append(`message.${result}`, { ticketId: m.ticketId, messageId: id });
      });
    } catch (err) { if (!(err instanceof Later)) this.store.outbox.save({ ...m, attempts: m.attempts + 1 }); throw err; }
  }
}
