import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Store, Thread, Trigger, Ticket, Decision, EffectRow, OutboxMessage, LedgerEntry } from '../core/ports.ts';

/** SQLite aggregates, transactional outbox, leased effect queue, and append-only trace. */
export class SqliteStore implements Store {
  readonly db: DatabaseSync;
  private depth = 0;
  private callbacks: (() => void)[] = [];
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, dedupeKey TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL DEFAULT 0, leaseUntil INTEGER NOT NULL DEFAULT 0, lastError TEXT);
      CREATE INDEX IF NOT EXISTS effect_due ON effects(status,nextAttemptAt);
      CREATE UNIQUE INDEX IF NOT EXISTS effect_pending_key ON effects(kind,dedupeKey) WHERE status='pending';
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(id UNINDEXED, repository UNINDEXED, path, title, body, tokenize='porter unicode61');
    `);
    this.setValue('schemaVersion', 1);
  }
  close() { this.db.close(); }
  atomic<T>(work: () => T): T {
    const level = this.depth++;
    const callbackStart = this.callbacks.length;
    this.db.exec(level ? `SAVEPOINT tx${level}` : 'BEGIN IMMEDIATE');
    let value: T;
    try {
      value = work();
      if (value instanceof Promise) throw new Error('Store transactions must be synchronous');
      this.db.exec(level ? `RELEASE tx${level}` : 'COMMIT');
    } catch (err) {
      this.db.exec(level ? `ROLLBACK TO tx${level}; RELEASE tx${level}` : 'ROLLBACK');
      this.callbacks.length = callbackStart;
      throw err;
    } finally { this.depth--; }
    if (!level) { const pending = this.callbacks.splice(0); for (const fn of pending) fn(); }
    return value;
  }
  afterCommit(fn: () => void) { if (this.depth) this.callbacks.push(fn); else fn(); }
  get<T>(kind: string, id: string): T | undefined {
    const r = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) as T : undefined;
  }
  save<T>(kind: string, id: string, value: T) { this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updatedAt=excluded.updatedAt').run(kind, id, JSON.stringify(value), new Date().toISOString()); }
  list<T>(kind: string): T[] { return (this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind) as { data: string }[]).map(r => JSON.parse(r.data)); }
  remove(kind: string, id: string) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  getValue<T>(key: string): T | undefined { return this.get<T>('kv', key); }
  setValue<T>(key: string, value: T | undefined) { if (value === undefined) this.remove('kv', key); else this.save('kv', key, value); }
  triggers = { get: (id: string) => this.get<Trigger>('trigger', id), save: (t: Trigger) => this.save('trigger', t.id, t), list: () => this.list<Trigger>('trigger') };
  threads = { get: (id: string) => this.get<Thread>('thread', id), save: (t: Thread) => this.save('thread', t.key, t), list: () => this.list<Thread>('thread'), active: () => this.list<Thread>('thread').filter(t => t.eval || t.queued.length) };
  tickets = { get: (id: string) => this.get<Ticket>('ticket', id), save: (t: Ticket) => this.save('ticket', t.id, t), list: () => this.list<Ticket>('ticket'), open: () => this.list<Ticket>('ticket').filter(t => t.state === 'open') };
  decisions = { save: (d: Decision) => this.save('decision', d.id, d), byThread: (k: string) => this.list<Decision>('decision').filter(d => d.audit?.threadKey === k) };
  outbox = { get: (id: string) => this.get<OutboxMessage>('outbox', id), save: (m: OutboxMessage) => this.save('outbox', m.id, m), list: () => this.list<OutboxMessage>('outbox'), pending: () => this.list<OutboxMessage>('outbox').filter(m => m.status === 'pending').sort((a, b) => a.queuedSeq - b.queuedSeq) };
  ledger = { add: (e: LedgerEntry) => this.save('ledger', e.id, e), all: () => this.list<LedgerEntry>('ledger'), byTicket: (id: string) => this.list<LedgerEntry>('ledger').filter(e => e.ticketId === id) };
  events = {
    append: (type: string, data: unknown) => Number(this.db.prepare('INSERT INTO events(type,at,data) VALUES(?,?,?)').run(type, new Date().toISOString(), JSON.stringify(data)).lastInsertRowid),
    since: (seq: number) => (this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq').all(seq) as { seq: number; type: string; at: string; data: string }[]).map(r => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> })),
  };
  effects = {
    enqueue: (kind: string, dedupeKey: string, payload: unknown) => {
      const old = this.db.prepare("SELECT id FROM effects WHERE kind=? AND dedupeKey=? AND status='pending'").get(kind, dedupeKey) as { id: string } | undefined;
      if (old) this.db.prepare('UPDATE effects SET payload=?,nextAttemptAt=0 WHERE id=?').run(JSON.stringify(payload), old.id);
      else this.db.prepare("INSERT INTO effects(id,kind,dedupeKey,payload,status) VALUES(?,?,?,?,'pending')").run(randomUUID(), kind, dedupeKey, JSON.stringify(payload));
    },
    claim: (limit: number, leaseMs = 900000): EffectRow[] => this.atomic(() => {
      const rows = this.db.prepare("SELECT * FROM effects WHERE status='pending' AND nextAttemptAt<=? ORDER BY seq LIMIT ?").all(Date.now(), limit) as unknown as EffectRow[];
      for (const r of rows) this.db.prepare("UPDATE effects SET status='running',leaseUntil=? WHERE id=?").run(Date.now() + leaseMs, r.id);
      return rows.map(r => ({ ...r, status: 'running', payload: JSON.parse(String(r.payload)) }));
    }),
    done: (id: string) => { this.db.prepare("UPDATE effects SET status='done',leaseUntil=0 WHERE id=?").run(id); },
    defer: (id: string, due: number, error?: string, failure = true) => {
      const row = this.db.prepare('SELECT kind,dedupeKey FROM effects WHERE id=?').get(id) as { kind: string; dedupeKey: string } | undefined;
      if (!row) return;
      const newer = this.db.prepare("SELECT id FROM effects WHERE kind=? AND dedupeKey=? AND status='pending'").get(row.kind, row.dedupeKey);
      if (newer) this.effects.done(id);
      else this.db.prepare("UPDATE effects SET status='pending',attempts=attempts+?,nextAttemptAt=?,leaseUntil=0,lastError=? WHERE id=?").run(failure ? 1 : 0, due, error?.slice(0, 1000) ?? null, id);
    },
    pending: () => (this.db.prepare("SELECT * FROM effects WHERE status!='done' ORDER BY seq").all() as unknown as EffectRow[]).map(r => ({ ...r, payload: JSON.parse(String(r.payload)) })),
    recover: () => { const running = this.db.prepare("SELECT id FROM effects WHERE status='running'").all() as { id: string }[]; for (const r of running) this.effects.defer(r.id, 0, 'host restarted', false); return running.length; },
  };
  query(sql: string, ...values: SQLInputValue[]) { return this.db.prepare(sql).all(...values); }
  run(sql: string, ...values: SQLInputValue[]) { return this.db.prepare(sql).run(...values); }
}
