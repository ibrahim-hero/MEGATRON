import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { githubEnvironment } from './github-auth.mjs';
const gh=resolve('tools/github/bin/gh.exe');
const env=githubEnvironment(gh,{...process.env,GH_CONFIG_DIR:resolve('tools/github/config')});
const result=spawnSync(gh,['api','user','--jq','.login'],{env,encoding:'utf8'});
if(result.status!==0){console.log('GitHub authentication is not ready.');process.exitCode=1;}
else console.log(`GitHub account verified: ${result.stdout.trim()}`);
