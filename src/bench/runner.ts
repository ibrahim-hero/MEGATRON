import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Runtime, demoSettings } from '../app/runtime.ts';
import type { MegatronSettings } from '../policy.ts';
export interface BenchmarkCase { id: string; scenario: string; expected: 'delivered' | 'blocked' }
export const benchmarkCases: BenchmarkCase[] = [
  { id: 'discount-boundaries', scenario: 'shop', expected: 'delivered' },
  { id: 'pagination-boundaries', scenario: 'pagination', expected: 'delivered' },
  { id: 'slug-normalization', scenario: 'slug', expected: 'delivered' },
  { id: 'versioned-api', scenario: 'backend', expected: 'delivered' },
  { id: 'contract-client', scenario: 'client', expected: 'delivered' },
  { id: 'reject-false-ready', scenario: 'liar', expected: 'blocked' },
];
export async function runBenchmark(root: string, options: { cases?: BenchmarkCase[]; models?: MegatronSettings['models']; skillInstructions?: string } = {}) {
  await mkdir(root, { recursive: true }); const rows = [];
  for (const task of options.cases ?? benchmarkCases) {
    const settings = demoSettings(); settings.policy.gates.delivery = false;
    if (options.models) settings.models = options.models;
    const runtime = await Runtime.create({ stateDir: join(root, task.id), settings }); const start = Date.now();
    try {
      const id = runtime.submitDemo(task.scenario); if(options.skillInstructions)runtime.store.save('skill-trial-context',id,options.skillInstructions); const t = await runtime.waitTicket(id);
      const verified = t.ended?.outcome === 'delivered' && !!t.verifiedFingerprint;
      const expected = task.expected === 'delivered' ? verified : t.stage === 'needs-you' && !t.verifiedFingerprint;
      rows.push({ id: task.id, ticketId: id, expected, verified, intended: task.expected, outcome: t.ended?.outcome ?? t.assignments.at(-1)?.report?.state, wallTimeMs: Date.now() - start, ...runtime.ledger.summary(id), evidence: t.evidence.filter(e=>e.runId===t.verificationRun).map(e => ({ criterion: e.criterion, status: e.status, fingerprint: e.fingerprint })), mode: options.models ? 'configured-model' : 'scripted-demo' });
      await writeFile(join(root, task.id, 'trace.json'), JSON.stringify(runtime.store.events.since(0), null, 2));
    } finally { await runtime.close(); }
  }
  const report = { id: `bench-${Date.now()}`, at: new Date().toISOString(), mode: options.models ? 'configured-model' : 'scripted-demo', total: rows.length, positiveTasks: rows.filter(r => r.intended === 'delivered').length, verified: rows.filter(r => r.verified).length, expectedOutcomesPassed: rows.filter(r => r.expected).length, falseReadyRejected: rows.filter(r => r.intended === 'blocked' && r.expected).length, regressions: rows.filter(r => r.verified && r.evidence.some(e => e.status !== 'pass')).length, usd: rows.reduce((n, r) => n + r.usd, 0), tokens: rows.reduce((n, r) => n + r.tokens, 0), rows, note: options.models ? 'Measured configured-provider run on the same repository fixtures.' : 'Deterministic model scripts execute real code changes and tests. These results validate the harness, not superiority over a live coding model.' };
  await writeFile(join(root, 'scorecard.json'), JSON.stringify(report, null, 2)); return report;
}
