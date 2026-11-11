import type { EffectRow, Store } from './core/ports.ts';
export class Later extends Error {
  reason: string; delayMs: number;
  constructor(reason: string, delayMs = 250) { super(reason); this.reason = reason; this.delayMs = delayMs; }
}
export class Effects {
  private handlers = new Map<string, (row: EffectRow) => Promise<void>>();
  private busy = false;
  readonly store: Store;
  constructor(store: Store) { this.store = store; }
  handle(kind: string, run: (row: EffectRow) => Promise<void>) { if (this.handlers.has(kind)) throw new Error(`Duplicate effect handler: ${kind}`); this.handlers.set(kind, run); }
  enqueue(kind: string, key: string, payload: unknown) { this.store.effects.enqueue(kind, key, payload); }
  async drain(concurrency = 4) {
    if (this.busy) return 0;
    this.busy = true;
    let processed = 0;
    try {
      const rows = this.store.effects.claim(concurrency);
      await Promise.all(rows.map(async row => {
        try {
          const run = this.handlers.get(row.kind);
          if (!run) throw new Error(`Unregistered effect handler: ${row.kind}`);
          await run(row); this.store.effects.done(row.id); processed++;
        } catch (err) {
          if (err instanceof Later) this.store.effects.defer(row.id, Date.now() + err.delayMs, err.message, false);
          else { this.store.effects.defer(row.id, Date.now() + Math.min(60000, 500 * 2 ** row.attempts), String(err), true); this.store.events.append('effect.failed', { kind: row.kind, key: row.dedupeKey, attempts: row.attempts + 1, error: String(err) }); }
        }
      }));
    } finally { this.busy = false; }
    return processed;
  }
  pendingCount() { return this.store.effects.pending().length; }
  get active() { return this.busy; }
}
