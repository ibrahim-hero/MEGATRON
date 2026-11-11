import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store, Ticket, Sandbox, Evidence, VerificationResult } from './core/ports.ts';
import { fingerprint, sha256 } from './infra/files.ts';
import type { MegatronSettings } from './policy.ts';

/** Host-owned receipts tied to the exact tree and immutable acceptance-check configuration. */
export class EvidenceService {
  readonly store: Store; readonly sandbox: Sandbox; readonly settings: () => MegatronSettings; readonly baselineOf: (t: Ticket) => string;
  constructor(store: Store, sandbox: Sandbox, settings: () => MegatronSettings, baselineOf: (t: Ticket) => string) { this.store = store; this.sandbox = sandbox; this.settings = settings; this.baselineOf = baselineOf; }
  async run(t: Ticket, dir: string, baseline = false, signal?: AbortSignal): Promise<VerificationResult> {
    const runId = randomUUID(); const hash = await fingerprint(dir); const receipts: Evidence[] = [];
    const trusted = this.settings().repositories[t.repository]?.trustedTests ?? [];
    let tampered = false;
    if (!baseline) for (const path of trusted) {
      try { if (sha256(await readFile(join(dir, path))) !== sha256(await readFile(join(this.baselineOf(t), path)))) tampered = true; } catch { tampered = true; }
    }
    for (const check of t.criteria) {
      const result = tampered ? { exitCode: 1, stdout: '', stderr: 'A trusted acceptance-check file was modified or deleted', durationMs: 0 } : await this.sandbox.run(dir, check.command, { timeoutMs: check.timeoutMs, signal, env: { MEGATRON_WORKSPACE: dir } });
      const base = this.store.get<Evidence[]>('baseline', t.id)?.find(e => e.criterion === check.id);
      const redGreen = baseline || !check.regression || (!!base && base.exitCode === 1);
      receipts.push({ id: randomUUID(), runId, ticketId: t.id, criterion: check.id, command: check.command, fingerprint: hash, status: result.exitCode === 0 && redGreen ? 'pass' : 'fail', exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}${!redGreen ? '\nRegression criterion requires a failing baseline test (exit 1).' : ''}`.trim(), durationMs: result.durationMs, baseline, at: new Date().toISOString(), environment: `${this.sandbox.name}; node ${process.versions.node}; ${process.platform}` });
    }
    if (await fingerprint(dir) !== hash) for (const e of receipts) { e.status = 'error'; e.output += '\nWorkspace changed during verification; repeat the checks.'; }
    this.store.atomic(() => { for (const e of receipts) this.store.save('evidence', e.id, e); if (baseline) this.store.save('baseline', t.id, receipts); });
    return { runId, fingerprint: hash, receipts };
  }
}
export const extractCriteria = (request: string) => request.split('\n').filter(l => /^\s*[-*]\s/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, ''));
