import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OutboxMessage } from '../core/ports.ts';
import type { ChannelSender } from '../outbox.ts';
export class SourceRegistry {
  readonly senders = new Map<string, ChannelSender>();
  readonly health = new Map<string, { state: 'ready' | 'paused' | 'error'; detail: string; failures: number }>();
  register(id: string, sender: ChannelSender) { if (this.senders.has(id)) throw new Error(`Duplicate source: ${id}`); this.senders.set(id, sender); this.health.set(id, { state: 'ready', detail: 'Connected', failures: 0 }); }
  failure(id: string, error: unknown) { const previous = this.health.get(id); const failures = (previous?.failures ?? 0) + 1; this.health.set(id, { state: failures >= 3 ? 'error' : 'ready', detail: String(error), failures }); }
  success(id: string) { this.health.set(id, { state: 'ready', detail: 'Connected', failures: 0 }); }
  overview() { return [...this.health].map(([id, state]) => ({ id, ...state })); }
}
/** Idempotent local conversation receipts; useful for CLI and offline demos. */
export class FileChannel implements ChannelSender {
  root: string;
  constructor(root: string) { this.root = root; }
  async send(m: OutboxMessage): Promise<'sent'> {
    await mkdir(this.root, { recursive: true });
    const name = m.id.replace(/[^a-z0-9_-]/gi, '_');
    try { await writeFile(join(this.root, `${name}.json`), JSON.stringify(m, null, 2), { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return 'sent';
  }
}
