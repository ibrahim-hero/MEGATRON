import { readdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
const root=resolve('tools/final-benchmark/benchmarks');const reports=[];
for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory())continue;try{reports.push(JSON.parse(await readFile(join(root,entry.name,'scorecard.json'),'utf8')));}catch{}}
const report=reports.sort((a,b)=>b.at.localeCompare(a.at))[0];
if(!report||report.expectedOutcomesPassed!==report.total)throw new Error('No successful measured scorecard is available');
await writeFile(resolve('assets/benchmark-scorecard.json'),JSON.stringify(report,null,2));
console.log(`Preserved measured scorecard: ${report.verified}/${report.positiveTasks} verified tasks; ${report.falseReadyRejected} false-ready claim rejected.`);
