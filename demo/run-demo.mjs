import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Runtime, demoSettings } from '../src/app/runtime.ts';
export async function runDemo(output = fileURLToPath(new URL('./output/', import.meta.url))) {
  await mkdir(output, { recursive: true }); const root = join(output, `run-${Date.now()}`);
  const r = await Runtime.create({ stateDir: root, settings: demoSettings() });
  try {
    const id = r.submitDemo('shop'); const pending = await r.waitTicket(id);
    if (!pending.verifiedFingerprint || !pending.approvals.some(a => a.status === 'pending')) throw new Error('Demo did not reach a verified approval gate');
    await r.approve(id); await r.tick(); const delivered = r.engine.require(id);
    if (delivered.ended?.outcome !== 'delivered') throw new Error('Demo delivery did not finish');
    const rejectedId = r.submitDemo('liar'); const rejected = await r.waitTicket(rejectedId);
    if (rejected.verifiedFingerprint) throw new Error('The host accepted a false-ready report');
    const specId = r.submitDemo('speculation'); const candidate = await r.waitTicket(specId);
    if (!candidate.verifiedFingerprint) throw new Error('Speculative winner did not verify');
    await r.approve(specId); await r.tick();
    const summary = { product: 'MEGATRON', mode: 'scripted demo; real file changes and executed verification', stateDir: root, delivered: delivered.id, rejectedFalseReady: rejected.id, speculativeWinner: r.store.list('speculation'), ledger: r.ledger.summary(), delivery: delivered.delivery, at: new Date().toISOString() };
    await writeFile(join(output, 'latest.json'), JSON.stringify(summary, null, 2));
    await writeFile(join(output, 'timeline.json'), JSON.stringify(r.store.events.since(0), null, 2));
    console.log(`MEGATRON demo passed\n  Verified delivery: ${delivered.id}\n  False-ready rejected: ${rejected.id}\n  Speculative winner: ${specId}\n  Evidence and artifacts: ${root}`);
    return summary;
  } finally { await r.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) runDemo().catch(e => { console.error(e); process.exitCode = 1; });
