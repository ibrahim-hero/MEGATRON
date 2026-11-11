import type { Store } from '../core/ports.ts';
export interface RolloutState { id: string; ticketId: string; status: 'started' | 'deployed' | 'healthy' | 'rolled-back'; samples: { value?: number; healthy: boolean; at: string }[]; deployed?: boolean; rollback?: boolean; at: string }
/** Resume from durable deployment receipts; rollback is a declared workflow action. */
export async function runRollout(store: Store, options: { id: string; ticketId: string; deploy: () => Promise<unknown>; health: () => Promise<{ healthy: boolean; value?: number }>; rollback: () => Promise<unknown>; maxValue?: number; samples?: number }) {
  const state = store.get<RolloutState>('rollout', options.id) ?? { id: options.id, ticketId: options.ticketId, status: 'started', samples: [], at: new Date().toISOString() };
  if (state.status === 'healthy' || state.status === 'rolled-back') return state;
  store.save('rollout', state.id, state);
  if (!state.deployed) { await options.deploy(); state.deployed = true; state.status = 'deployed'; store.save('rollout', state.id, state); }
  for (let i = state.samples.length; i < (options.samples ?? 3); i++) {
    const sample = await options.health(); state.samples.push({ ...sample, at: new Date().toISOString() }); store.save('rollout', state.id, state);
    if (!sample.healthy || (options.maxValue !== undefined && (sample.value === undefined || sample.value > options.maxValue))) { if (!state.rollback) { await options.rollback(); state.rollback = true; } state.status = 'rolled-back'; store.save('rollout', state.id, state); store.events.append('rollout.rolled-back', { ticketId: state.ticketId, rolloutId: state.id }); return state; }
  }
  state.status = 'healthy'; store.save('rollout', state.id, state); store.events.append('rollout.healthy', { ticketId: state.ticketId, rolloutId: state.id }); return state;
}
