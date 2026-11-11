import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Sandbox } from '../core/ports.ts';
import { copyTree } from '../infra/files.ts';
import { runProcess } from '../infra/process.ts';
export class LocalSandbox implements Sandbox {
  name = 'local'; blocked: string[];
  constructor(blocked: string[] = []) { this.blocked = blocked; }
  async prepare(dir: string, source?: string) {
    if (existsSync(dir)) return; // Preserve checkpoints and interrupted work.
    if (source && !existsSync(source)) throw new Error(`Repository does not exist: ${source}`);
    await mkdir(dir, { recursive: true }); if (source) await copyTree(source, dir);
  }
  run(dir: string, command: string | string[], opts: Parameters<Sandbox['run']>[2] = {}) {
    const text = Array.isArray(command) ? command.join(' ') : command;
    if (this.blocked.some(b => text.includes(b))) return Promise.resolve({ exitCode: 126, stdout: '', stderr: 'Command blocked by deployment settings', durationMs: 0 });
    return runProcess(dir, command, opts);
  }
}
/** Explicit OS isolation. Fails if Docker is unavailable; never silently falls back. */
export class ContainerSandbox implements Sandbox {
  name = 'container'; image: string;
  constructor(image = 'node:24-bookworm-slim') { this.image = image; }
  prepare(dir: string, source?: string) { return new LocalSandbox().prepare(dir, source); }
  async available(dir: string) { return (await runProcess(dir, ['docker', 'info', '--format', '{{.ServerVersion}}'], { timeoutMs: 10000 })).exitCode === 0; }
  run(dir: string, command: string | string[], opts: Parameters<Sandbox['run']>[2] = {}) {
    const argv = typeof command === 'string' ? ['sh', '-lc', command] : command.map(a => a.replaceAll(resolve(dir), '/work').replaceAll('\\', '/'));
    const args = ['docker', 'run', '--rm', '--pull=never', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--memory=1g', '--cpus=2', '--pids-limit=128', '--user=node', '--tmpfs=/tmp:rw,nosuid,nodev,size=128m', '--mount', `type=bind,source=${resolve(dir)},target=/work`, '--workdir=/work'];
    if (opts.verifierDir) args.push('--mount', `type=bind,source=${resolve(opts.verifierDir)},target=/verify,readonly`);
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push('-e', `${k}=${v}`);
    return runProcess(dir, [...args, this.image, ...argv], { timeoutMs: opts.timeoutMs, signal: opts.signal });
  }
}
export const createSandbox = (kind: string, blocked: string[] = [], image?: string): Sandbox => kind === 'container' ? new ContainerSandbox(image) : new LocalSandbox(blocked);
