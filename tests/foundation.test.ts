import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SqliteStore } from '../src/store/store.ts';
import { Effects, Later } from '../src/effects.ts';
import { Runtime, demoSettings } from '../src/app/runtime.ts';
import { ScriptedProvider, HttpProvider } from '../src/llm/providers.ts';
import { temporary } from './helpers.ts';
import { DEFAULT_SETTINGS, settingsPolicy, validateSettings } from '../src/policy.ts';
import { fingerprint } from '../src/infra/files.ts';

test('nested transactions roll back facts and post-commit callbacks together', async () => {
  const tmp = await temporary(); const s = new SqliteStore(join(tmp.dir, 'store.sqlite')); let callbacks = 0;
  try {
    s.atomic(() => { s.setValue('outer', 1); assert.throws(() => s.atomic(() => { s.setValue('inner', 2); s.afterCommit(() => callbacks++); throw new Error('rollback'); })); s.afterCommit(() => callbacks++); });
    assert.equal(s.getValue('outer'), 1); assert.equal(s.getValue('inner'), undefined); assert.equal(callbacks, 1);
    assert.throws(() => s.atomic(() => { s.setValue('lost', true); throw new Error('rollback'); })); assert.equal(s.getValue('lost'), undefined);
  } finally { s.close(); await tmp.dispose(); }
});
test('re-enqueue during a running effect preserves the new payload', async () => {
  const tmp = await temporary(); const s = new SqliteStore(join(tmp.dir, 'store.sqlite')); const effects = new Effects(s); const seen: number[] = [];
  try { effects.handle('work', async r => { const n = (r.payload as { n: number }).n; seen.push(n); if (n === 1) effects.enqueue('work', 'same', { n: 2 }); }); effects.enqueue('work', 'same', { n: 1 }); await effects.drain(); await effects.drain(); assert.deepEqual(seen, [1,2]); assert.equal(effects.pendingCount(), 0); } finally { s.close(); await tmp.dispose(); }
});
test('capacity deferrals do not increment failure attempts', async () => {
  const tmp = await temporary(); const s = new SqliteStore(join(tmp.dir, 'store.sqlite')); const e = new Effects(s);
  try { e.handle('work', async () => { throw new Later('occupied'); }); e.enqueue('work', 'one', {}); await e.drain(); assert.equal(s.effects.pending()[0].attempts, 0); } finally { s.close(); await tmp.dispose(); }
});
test('scripted provider is deterministic across replayed contexts', async () => {
  const p = new ScriptedProvider([{ text: 'first' }, { text: 'second' }]); const input = { messages: [{role:'user' as const,text:'task'}] };
  assert.deepEqual(await p.complete(input), await p.complete(input)); assert.equal((await p.complete({messages:[...input.messages,{role:'assistant',text:'first'}]})).text,'second');
});
test('configuration rejects empty checks and an invalid worker limit', () => {
  assert.throws(() => validateSettings({...DEFAULT_SETTINGS,executor:{...DEFAULT_SETTINGS.executor,maxWorkers:0}}));
  assert.throws(() => validateSettings({...DEFAULT_SETTINGS,repositories:{empty:{path:'.',verify:[]}}}));
});
test('identical sender names do not inherit permissions across sources',()=>{const settings=demoSettings();const make=(source:string)=>({id:'event',source,threads:[source+':thread'],actor:{source,id:'operator'},human:true,addressed:'direct' as const,at:new Date().toISOString(),text:'fix',channel:{source,thread:source+':thread',address:{}},meta:{}});assert.equal(settingsPolicy(settings).gate(make('local')).admissible,true);assert.equal(settingsPolicy(settings).gate(make('github')).admissible,false);settings.policy.sources.github={allowed:['operator']};assert.equal(settingsPolicy(settings).gate(make('github')).admissible,true);});
test('verification gates delivery and rejects a false-ready worker', async () => {
  const tmp = await temporary(); const r = await Runtime.create({stateDir:tmp.dir,settings:demoSettings()});
  try {
    const id=r.submitDemo('shop'); const t=await r.waitTicket(id); assert.equal(t.stage,'needs-you'); assert.ok(t.verifiedFingerprint, JSON.stringify({report:t.assignments.at(-1)?.report,evidence:t.evidence})); assert.equal(t.evidence.length,1);
    const baseline=r.store.get<any[]>('baseline',id)!; assert.equal(baseline[0].exitCode,1); assert.equal(t.evidence[0].exitCode,0);
    await r.approve(id); await r.tick(); assert.equal(r.engine.require(id).ended?.outcome,'delivered');
    const liar=await r.waitTicket(r.submitDemo('liar')); assert.equal(liar.stage,'needs-you'); assert.equal(liar.verifiedFingerprint,undefined); assert.equal(liar.evidence[0].status,'fail'); assert.equal(r.ledger.summary(liar.id).attention,1); assert.equal(r.ledger.summary(liar.id).messages,2);
  } finally {await r.close();await tmp.dispose();}
});
test('settled messages are idempotent and stay represented as sent receipts', async () => {
  const tmp=await temporary();const r=await Runtime.create({stateDir:tmp.dir,settings:demoSettings()});
  try {const m={id:'same-receipt',channel:{source:'local',thread:'local:test',address:{}},text:'once',kind:'notice' as const};r.outbox.send(m);await r.tick();assert.equal(r.outbox.status(m.id),'sent');r.outbox.send({...m,text:'changed'});await r.tick();assert.equal(r.store.outbox.list().length,1);assert.equal(r.store.outbox.list()[0].text,'once');assert.equal(r.ledger.summary().messages,1);}finally{await r.close();await tmp.dispose();}
});
