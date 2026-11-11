import { randomUUID } from 'node:crypto';
import type { LedgerEntry, Store } from './core/ports.ts';
export class Ledger {
  readonly store: Store;
  constructor(store: Store) { this.store = store; }
  add(e: { ticketId?: string; kind: LedgerEntry['kind']; amount: number; detail?: string; id?: string; model?: string }) {
    if (!Number.isFinite(e.amount) || e.amount < 0) throw new Error('Invalid ledger amount');
    this.store.ledger.add({ ...e, id: e.id ?? randomUUID(), at: new Date().toISOString() });
  }
  tokens(id: string, input: number, output: number, requestId?: string, model?: string) { this.add({ ticketId: id, kind: 'tokens', amount: input + output, detail: `input:${input} output:${output}`, id: requestId ? `${requestId}:tokens` : undefined, model }); }
  cost(id: string, usd: number, requestId?: string, model?: string) { this.add({ ticketId: id, kind: 'cost', amount: usd, id: requestId ? `${requestId}:cost` : undefined, model }); }
  message(id?: string, receiptId?: string) { this.add({ ticketId: id, kind: 'message', amount: 1, id: receiptId ? `${receiptId}:message` : undefined }); }
  attention(id: string, key?: string) { this.add({ ticketId: id, kind: 'attention', amount: 1, id: key ? `${key}:attention` : undefined }); }
  humanInput(id: string) { this.add({ ticketId: id, kind: 'humanInput', amount: 1 }); }
  summary(ticketId?: string) {
    const rows = ticketId ? this.store.ledger.byTicket(ticketId) : this.store.ledger.all();
    const s = { usd: 0, tokens: 0, messages: 0, attention: 0, humanInputs: 0, durationMs: 0 };
    for (const r of rows) { const map = { cost: 'usd', tokens: 'tokens', message: 'messages', attention: 'attention', humanInput: 'humanInputs', duration: 'durationMs' } as const; s[map[r.kind]] += r.amount; }
    s.usd = Math.round(s.usd * 1000000) / 1000000;
    return s;
  }
}
