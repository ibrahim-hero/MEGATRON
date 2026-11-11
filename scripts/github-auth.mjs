import { spawnSync } from 'node:child_process';
/** Reuse the requested owner’s existing Git Credential Manager sign-in in memory. */
export function githubEnvironment(gh, baseEnv) {
  const env={...baseEnv};
  const status=spawnSync(gh,['auth','status'],{env,encoding:'utf8'});
  if(status.status===0)return env;
  const accounts=spawnSync('git',['credential-manager','github','list'],{env,encoding:'utf8'});
  if(accounts.status!==0||!accounts.stdout.split(/\r?\n/).includes('ibrahim-hero'))return env;
  const credential=spawnSync('git',['credential','fill'],{env:{...env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},input:'protocol=https\nhost=github.com\nusername=ibrahim-hero\n\n',encoding:'utf8'});
  if(credential.status!==0)return env;
  const password=credential.stdout.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice('password='.length);
  if(password)env.GH_TOKEN=password;
  return env;
}
