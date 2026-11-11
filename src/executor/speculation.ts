import { randomUUID } from 'node:crypto';
import type { Store } from '../core/ports.ts';
export interface CandidateResult { id: string; workspace: string; passed: boolean; cost: number; tokens: number; durationMs: number; detail: string; fingerprint: string }
export interface SpeculationRun { id: string; ticketId: string; candidates: CandidateResult[]; winner?: string; at: string }
export async function speculate(store: Store, ticketId: string, candidates: (() => Promise<CandidateResult>)[]) {
  if (!candidates.length || candidates.length > 4) throw new Error('Speculation needs 1..4 budgeted candidates');
  const results = await Promise.all(candidates.map(async (run, i) => { try { return await run(); } catch (e) { return { id: `candidate-${i}`, workspace: '', passed: false, cost: Infinity, tokens: 0, durationMs: 0, detail: String(e), fingerprint: '' }; } }));
  const winner = results.filter(c => c.passed).sort((a, b) => a.cost - b.cost || a.tokens - b.tokens || a.durationMs - b.durationMs)[0];
  const row: SpeculationRun = { id: randomUUID(), ticketId, candidates: results, winner: winner?.id, at: new Date().toISOString() }; store.save('speculation', row.id, row); store.events.append('speculation.finished', { ticketId, winner: row.winner, candidates: row.candidates.length }); return row;
}
