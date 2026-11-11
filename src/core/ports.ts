import type { Assignment, Checkpoint, Decision, EffectRow, Evidence, LedgerEntry, ModelReply, OutboxMessage, Thread, Ticket, Trigger, Message, ToolSpec, RunResult } from './model.ts';
export type * from './model.ts';
export interface Records {
  get<T>(kind: string, id: string): T | undefined;
  save<T>(kind: string, id: string, value: T): void;
  list<T>(kind: string): T[];
  remove(kind: string, id: string): void;
}
export interface Store extends Records {
  atomic<T>(work: () => T): T;
  afterCommit(work: () => void): void;
  getValue<T>(key: string): T | undefined;
  setValue<T>(key: string, value: T | undefined): void;
  triggers: { get(id: string): Trigger | undefined; save(t: Trigger): void; list(): Trigger[] };
  threads: { get(id: string): Thread | undefined; save(t: Thread): void; list(): Thread[]; active(): Thread[] };
  tickets: { get(id: string): Ticket | undefined; save(t: Ticket): void; list(): Ticket[]; open(): Ticket[] };
  decisions: { save(d: Decision): void; byThread(key: string): Decision[] };
  outbox: { get(id: string): OutboxMessage | undefined; save(m: OutboxMessage): void; list(): OutboxMessage[]; pending(): OutboxMessage[] };
  effects: { enqueue(kind: string, key: string, payload: unknown): void; claim(limit: number, leaseMs?: number): EffectRow[]; done(id: string): void; defer(id: string, dueAt: number, error?: string, failure?: boolean): void; pending(): EffectRow[]; recover(): number };
  ledger: { add(e: LedgerEntry): void; all(): LedgerEntry[]; byTicket(id: string): LedgerEntry[] };
  events: { append(type: string, data: unknown): number; since(seq: number): { seq: number; type: string; at: string; data: Record<string, unknown> }[] };
}
export interface Policy {
  version: string; acceptMode: 'auto' | 'observe'; paused: boolean;
  gate(t: Trigger): { admissible: true; strength: 'explicit' | 'inferred'; basis: string } | { admissible: false; reason: string };
  revalidate(t: Ticket['mandate']): boolean;
}
export interface Provider {
  model: string;
  complete(input: { system: string; messages: Message[]; tools: ToolSpec[]; signal?: AbortSignal }): Promise<ModelReply>;
}
export interface Sandbox {
  name: string;
  prepare(dir: string, source?: string): Promise<void>;
  run(dir: string, command: string | string[], opts?: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal; verifierDir?: string }): Promise<RunResult>;
}
export interface Executor {
  start(t: Ticket, a: Assignment): void; deliver(t: Ticket, a: Assignment): void; stop(t: Ticket, a: Assignment, reason: string): void;
}
export interface VerificationResult { runId: string; fingerprint: string; receipts: Evidence[] }
export interface Sessions {
  load(id: string): { messages: Message[]; checkpoint?: Checkpoint } | undefined;
  save(id: string, value: { messages: Message[]; checkpoint?: Checkpoint }): void;
}
