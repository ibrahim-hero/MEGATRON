import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '../core/ports.ts';
export async function runProcess(cwd: string, command: string | string[], opts: { timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string>; inheritEnv?: boolean } = {}): Promise<RunResult> {
  const start = Date.now(); const temp = join(cwd, '.tmp'); await mkdir(temp, { recursive: true });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'NODE_TEST_CONTEXT' && v !== undefined && (opts.inheritEnv || !/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|CREDENTIAL)/i.test(k))));
  const env = { ...inherited, TEMP: temp, TMP: temp, TMPDIR: temp, npm_config_cache: join(temp, 'npm-cache'), ...opts.env };
  const shell = typeof command === 'string';
  const program = shell ? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh') : command[0];
  const args = shell ? (process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]) : command.slice(1);
  return new Promise(resolve => {
    let settled = false; let stdout = ''; let stderr = ''; let forcedCode: number | undefined; let termination = Promise.resolve();
    const child = spawn(program, args, { cwd, env, detached: process.platform !== 'win32', windowsHide: true });
    const finish = (code: number) => { if (settled) return; settled = true; clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); resolve({ exitCode: code, stdout, stderr, durationMs: Date.now() - start }); };
    const kill = (): Promise<void> => {
      if (!child.pid) return Promise.resolve();
      if (process.platform === 'win32') return new Promise(resolve => { const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }); killer.on('error', () => { child.kill(); resolve(); }); killer.on('close', () => resolve()); });
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      return Promise.resolve();
    };
    const abort = () => { forcedCode = 130; termination = kill(); stderr += '\nInterrupted'; termination.then(() => { if (!child.pid) finish(130); }); };
    const timer = setTimeout(() => { forcedCode = 124; termination = kill(); stderr += '\nCommand timed out'; termination.then(() => { if (!child.pid) finish(124); }); }, opts.timeoutMs ?? 120000);
    if (opts.signal?.aborted) abort(); else opts.signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', d => { stdout = (stdout + String(d)).slice(-100000); });
    child.stderr?.on('data', d => { stderr = (stderr + String(d)).slice(-20000); });
    child.on('error', err => { stderr += String(err); finish(127); });
    child.on('close', code => { termination.then(() => finish(forcedCode ?? code ?? 1)); });
  });
}
