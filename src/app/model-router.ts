import type { Store } from '../core/ports.ts';
import type { ModelConfig } from '../policy.ts';
export interface RouteStats { calls: number; successes: number; failures: number; latencyMs: number }
export class ModelRouter {
  readonly store: Store; readonly models: () => ModelConfig[];
  constructor(store: Store, models: () => ModelConfig[]) { this.store = store; this.models = models; }
  choose(required = ['tools'], exclude: string[] = []): ModelConfig {
    const candidates = this.models().filter(m => required.every(c => m.capabilities.includes(c)) && !exclude.includes(m.id));
    if (!candidates.length) throw new Error(`No configured model supports ${required.join(', ')}`);
    return candidates.sort((a, b) => this.score(b) - this.score(a))[0];
  }
  score(m: ModelConfig) { const s = this.store.get<RouteStats>('route', m.id) ?? { calls: 0, successes: 0, failures: 0, latencyMs: 0 }; return (s.successes + 1) / (s.calls + 2) - (m.pricePer1kInput + m.pricePer1kOutput) * 0.01 - (s.calls ? s.latencyMs / s.calls / 1e6 : 0); }
  record(id: string, ok: boolean, latency: number) { const s = this.store.get<RouteStats>('route', id) ?? { calls: 0, successes: 0, failures: 0, latencyMs: 0 }; s.calls++; s.successes += Number(ok); s.failures += Number(!ok); s.latencyMs += latency; this.store.save('route', id, s); }
  overview() { return this.models().map(m => ({ ...m, score: this.score(m), stats: this.store.get<RouteStats>('route', m.id) })); }
}
