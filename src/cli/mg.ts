import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Runtime, demoSettings } from '../app/runtime.ts';
import { startServer } from '../app/server.ts';
import { runBenchmark } from '../bench/runner.ts';
import type { MegatronSettings, ModelConfig } from '../policy.ts';
import type { WorkNode } from '../workflows/dag.ts';
import { scenarios } from '../bench/scenarios.ts';
const help = `MEGATRON · evidence-first autonomous engineering

Usage: node bin/mg.js <command> [arguments] [--state directory] [--json]

  init                         Initialize persistent workspace settings
  serve [--demo] [--port 3082]  Start Mission Control and its API
  demo                         Execute the verified end-to-end demonstration
  run "request" --repo id       Start a task (--scenario shop for a declared demo)
  ls | status | costs          Inspect work, health, or compute/attention costs
  show id | diff id | replay id Inspect a mission and its persisted evidence
  watch id                     Follow a mission until a decision or delivery
  ask id "message"             Send an answer or steer ongoing work
  approve id | deny id "note"   Decide an evidence-bound delivery gate
  stop id | retry id           Stop or retry a mission without erasing its work
  action id apply|publish-pr|merge|deploy  Request a scoped side-effect gate
  bench [--live]               Run regression fixtures and adversarial checks
  knowledge search "query"     Search sourced context
  knowledge impact repo path   Find import dependents
  repo add id path --verify "command"  Register a repository and its checks
  model add id --provider openai|anthropic --model name [--base-url URL]
  workflow demo                Start a backend/client dependency graph
  skill propose id | skill validate id  Propose and validate reusable workflows
  plugin install manifest.json Install a SHA-256-pinned tool plugin
  mcp add id --command executable --args '["server.mjs"]'
  settings                    Print settings and revision history

Provider keys stay in environment variables. The default demonstration uses
declared scripts with real source edits and executed verification commands.
`;
function parse(argv: string[]) {
  const args: string[] = []; const flags: Record<string, string | boolean> = {};
  const bools = new Set(['json','demo','live','help','auto-approve']);
  for(let i=0;i<argv.length;i++) if(argv[i].startsWith('--')) { const key=argv[i].slice(2); flags[key]=bools.has(key)?true:argv[++i]??''; } else args.push(argv[i]);
  return {args,flags};
}
export async function runCli(argv: string[]) {
  const {args,flags}=parse(argv); const command=args.shift()??'help';
  if(command==='help'||flags.help){console.log(help);return;}
  const state=resolve(String(flags.state??join(process.cwd(),'.megatron',flags.demo?'demo':'workspace')));
  const print=(value:unknown)=>console.log(flags.json?JSON.stringify(value):typeof value==='string'?value:JSON.stringify(value,null,2));
  if(command==='demo'){const {runDemo}=await import('../../demo/run-demo.mjs' as string);print(await runDemo(join(state,'demo-output')));return;}
  let url=typeof flags.url==='string'?flags.url:undefined;
  if(!url&&existsSync(join(state,'server.json'))){const info=JSON.parse(await readFile(join(state,'server.json'),'utf8'));try{const r=await fetch(`${info.url}/api/status`,{signal:AbortSignal.timeout(1500),headers:process.env.MEGATRON_SERVER_TOKEN?{authorization:`Bearer ${process.env.MEGATRON_SERVER_TOKEN}`}:{}});if(r.ok)url=info.url;else if(r.status===401)throw new Error('Set MEGATRON_SERVER_TOKEN to connect to the running instance');}catch(e){if(String(e).includes('Set MEGATRON'))throw e;}}
  const call=async(path:string,data?:unknown)=>{const r=await fetch(`${url}/api/${path}`,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(process.env.MEGATRON_SERVER_TOKEN?{authorization:`Bearer ${process.env.MEGATRON_SERVER_TOKEN}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json() as any;if(!r.ok)throw new Error(value.error??`HTTP ${r.status}`);return value;};
  if(url&&command!=='serve'){
    if(['status','ls','costs','settings'].includes(command)){print(await call({status:'status',ls:'tickets',costs:'costs',settings:'settings'}[command]!));return;}
    if(command==='show'||command==='diff'||command==='replay'){print(await call(`tickets/${args[0]}${command==='diff'?'/diff':command==='replay'?'/timeline':''}`));return;}
    if(command==='run'){print(await call('run',{request:args.join(' '),repository:flags.repo,scenario:flags.scenario}));return;}
    if(['approve','deny','ask','stop','retry'].includes(command)){print(await call(`tickets/${args[0]}/${command}`,command==='ask'?{text:args.slice(1).join(' ')}:command==='deny'?{note:args.slice(1).join(' ')}:{}));return;}
    if(command==='action'){print(await call(`tickets/${args[0]}/action`,{action:args[1],payload:flags.payload?JSON.parse(String(flags.payload)):undefined}));return;}
    if(command==='bench'){print(await call('benchmarks',{live:!!flags.live}));return;}
    if(command==='workflow'&&args[0]==='demo'){print(await call('workflows',{demo:true}));return;}
    if(command==='knowledge'&&args[0]==='search'){print(await call(`knowledge?q=${encodeURIComponent(args.slice(1).join(' '))}`));return;}
    if(command==='watch'){const id=args[0];let previous='';for(;;){const t=await call(`tickets/${id}`);const line=JSON.stringify({id,stage:t.stage,report:t.assignments.at(-1)?.report?.summary});if(line!==previous){print(JSON.parse(line));previous=line;}if(t.state==='ended'||t.stage==='needs-you')return;await new Promise(r=>setTimeout(r,750));}}
    throw new Error('This administration command needs the daemon stopped; use the console settings or another state directory.');
  }
  await mkdir(state,{recursive:true});
  const runtime=await Runtime.create({stateDir:state,settings:flags.demo?demoSettings():undefined});let persistent=false;
  try {
    if(command==='init'){print({stateDir:state,settings:runtime.settings.path,version:'1.0.0'});return;}
    if(command==='serve'){
      if(flags.demo&&!runtime.store.tickets.list().length){runtime.submitDemo('shop');runtime.submitDemo('question');}
      const instance=await startServer(runtime,{port:Number(flags.port??3082),host:String(flags.host??'127.0.0.1')});persistent=true;print({product:'MEGATRON',url:instance.url,stateDir:state,mode:runtime.overview().mode});
      const stop=()=>instance.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
    }
    if(command==='status'){print(runtime.overview());return;}
    if(command==='ls'){print(runtime.store.tickets.list().map(t=>({id:t.id,title:t.title,repository:t.repository,stage:t.stage,outcome:t.ended?.outcome})));return;}
    if(command==='settings'){print({value:runtime.settings.current,revision:runtime.settings.revision});return;}
    if(command==='costs'){print({total:runtime.ledger.summary(),tickets:runtime.store.tickets.list().map(t=>({id:t.id,title:t.title,...runtime.ledger.summary(t.id)}))});return;}
    if(command==='show'){print(runtime.engine.require(args[0]));return;}
    if(command==='diff'){const t=runtime.engine.require(args[0]);const {diffTrees}=await import('../infra/files.ts');print(await diffTrees(runtime.executor.baseline(t),runtime.executor.workspace(t)));return;}
    if(command==='replay'){print(runtime.store.events.since(0).filter(e=>e.data.ticketId===args[0]));return;}
    if(command==='run'){const id=runtime.submit(args.join(' '),{repository:String(flags.repo??Object.keys(runtime.settings.current.repositories)[0]??''),scenario:typeof flags.scenario==='string'?flags.scenario:undefined});print(await runtime.waitTicket(id));return;}
    if(command==='watch'){print(await runtime.waitTicket(args[0]));return;}
    if(command==='ask'){runtime.engine.ask(args[0],args.slice(1).join(' '));print(await runtime.waitTicket(args[0]));return;}
    if(command==='stop'){print(runtime.engine.stopTicket(args[0]));return;}
    if(command==='retry'){runtime.engine.retryTicket(args[0]);print(await runtime.waitTicket(args[0]));return;}
    if(command==='approve'||command==='deny'){print(await runtime.approve(args[0],undefined,command==='approve',args.slice(1).join(' ')));await runtime.tick();return;}
    if(command==='action'){print(await runtime.armAction(args[0],args[1] as any,flags.payload?JSON.parse(String(flags.payload)):{}));return;}
    if(command==='bench'){const report=await runBenchmark(join(state,'benchmarks',randomUUID()),flags.live?{models:runtime.settings.current.models.filter(m=>m.provider!=='demo')}:{});runtime.store.save('benchmark',report.id,{...report,status:'completed'});print(report);if(report.expectedOutcomesPassed!==report.total)process.exitCode=2;return;}
    if(command==='knowledge'){
      if(args[0]==='search')print(await runtime.knowledge.search(args.slice(1).join(' '),typeof flags.repo==='string'?flags.repo:undefined));
      else if(args[0]==='impact')print(runtime.knowledge.impact(args[1],args[2]));else if(args[0]==='index'){const repo=runtime.settings.current.repositories[args[1]];if(!repo)throw new Error('Unknown repository');print(await runtime.knowledge.index(args[1],repo.path));}else throw new Error('Use knowledge search, impact, or index');return;
    }
    if(command==='repo'&&args[0]==='add'){
      const commandLine=String(flags.verify??'');if(!commandLine)throw new Error('Supply --verify with an executable acceptance check');const value=structuredClone(runtime.settings.current);
      const test=commandLine.match(/(?:^|\s)([\w/.-]+\.test\.[cm]?js)(?:\s|$)/)?.[1];
      value.repositories[args[1]]={path:resolve(args[2]),verify:[{id:'acceptance',label:'Repository acceptance check',command:commandLine,timeoutMs:120000}],trustedTests:test?[test,'package.json']:[]};await runtime.settings.save(value,runtime.settings.revision);print({repository:args[1],path:value.repositories[args[1]].path});return;
    }
    if(command==='model'&&args[0]==='add'){
      const value=structuredClone(runtime.settings.current);const model:ModelConfig={id:args[1],provider:String(flags.provider??'openai') as ModelConfig['provider'],model:String(flags.model??''),baseUrl:typeof flags['base-url']==='string'?flags['base-url']:undefined,apiKeyEnv:String(flags['key-env']??(flags.provider==='anthropic'?'ANTHROPIC_API_KEY':'OPENAI_API_KEY')),pricePer1kInput:Number(flags['input-price']??0),pricePer1kOutput:Number(flags['output-price']??0),capabilities:['tools']};value.models=value.models.filter(m=>m.id!==model.id&&m.provider!=='demo');value.models.push(model);await runtime.settings.save(value,runtime.settings.revision);print(model);return;
    }
    if(command==='workflow'&&args[0]==='demo'){
      const nodes:WorkNode[]=[{id:'backend',name:'Version backend contract',repository:'backend',request:scenarios.backend.title,scenario:'backend',role:'implementer',dependsOn:[],files:['src/api.js']},{id:'client',name:'Update client',repository:'client',request:scenarios.client.title,scenario:'client',role:'implementer',dependsOn:['backend'],files:['src/client.js']}];
      const w=runtime.workflows.create('Backend → client contract migration',nodes);for(let i=0;i<50;i++){await runtime.tick();const latest=runtime.store.get<any>('workflow',w.id);if(flags['auto-approve'])for(const n of latest.nodes){const t=n.ticketId&&runtime.store.tickets.get(n.ticketId);if(t?.approvals.some((a:any)=>a.status==='pending'))await runtime.approve(t.id);}if(latest.status==='completed'||(!flags['auto-approve']&&latest.status==='waiting'))break;}print(runtime.store.get('workflow',w.id));return;
    }
    if(command==='skill'&&args[0]==='propose'){print(runtime.skills.propose(runtime.engine.require(args[1])));return;}
    if(command==='skill'&&args[0]==='validate'){print(await runtime.skills.validate(args[1],async instructions=>{const report=await runBenchmark(join(state,'skill-trials',randomUUID()),{cases:[{id:'holdout-pagination',scenario:'pagination',expected:'delivered'},{id:'holdout-slug',scenario:'slug',expected:'delivered'}],skillInstructions:instructions});return{taskIds:report.rows.map(r=>r.ticketId),total:report.total,passed:report.verified,regressions:report.regressions};}));return;}
    if(command==='plugin'&&args[0]==='install'){print(await runtime.plugins.install(resolve(args[1])));return;}
    if(command==='mcp'&&args[0]==='add'){const value=structuredClone(runtime.settings.current);value.mcp.push({id:args[1],transport:flags.transport==='http'?'http':'stdio',command:String(flags.command??'node'),args:flags.args?JSON.parse(String(flags.args)):[],url:typeof flags['base-url']==='string'?flags['base-url']:undefined,enabled:true});await runtime.settings.save(value,runtime.settings.revision);print({id:args[1],restartRequired:true});return;}
    throw new Error(`Unknown command: ${command}. Run mg --help.`);
  } finally {if(!persistent)await runtime.close();}
}
