import { readdir, lstat, realpath, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, join, dirname, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const ignored = new Set(['.git', 'node_modules', '.megatron', '.tmp', 'tools', '.cache', 'test-results', 'playwright-report']);
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.') || entry.isSymbolicLink()) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await visit(p); else if (entry.isFile()) out.push(relative(root, p).split(sep).join('/'));
      if (out.length > 15000) throw new Error('Repository exceeds the 15,000-file indexing limit');
    }
  }
  await visit(root); return out.sort();
}
export async function safePath(root: string, path: string): Promise<string> {
  const base = resolve(root); const p = resolve(base, path); const rel = relative(base, p);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path escapes the workspace');
  for (const part of rel.split(sep)) if (ignored.has(part) || part === '.env' || part.startsWith('.env.')) throw new Error('Path is excluded from agent access');
  let cursor = base;
  const baseReal = await realpath(base);
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) continue;
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlink paths are excluded');
    const real = await realpath(cursor); const d = relative(baseReal, real);
    if (isAbsolute(d) || d === '..' || d.startsWith(`..${sep}`)) throw new Error('Resolved path escapes the workspace');
  }
  return p;
}
export async function writeWorkspace(root: string, path: string, content: string) {
  const p = await safePath(root, path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, content, 'utf8');
}
export async function fingerprint(root: string) {
  const hash = createHash('sha256');
  for (const path of await files(root)) { hash.update(path); hash.update('\0'); hash.update(await readFile(join(root, path))); hash.update('\0'); }
  return hash.digest('hex');
}
export async function copyTree(source: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const path of await files(source)) { const dest = join(target, path); await mkdir(dirname(dest), { recursive: true }); await cp(join(source, path), dest); }
}
export async function diffTrees(before: string, after: string) {
  const names = new Set([...(await files(before)), ...(await files(after))]);
  const changes: { path: string; before: string; after: string; originalHash: string | null; hash: string | null }[] = [];
  let patch = '';
  for (const path of [...names].sort()) {
    const oldBytes = existsSync(join(before, path)) ? await readFile(join(before, path)) : null;
    const newBytes = existsSync(join(after, path)) ? await readFile(join(after, path)) : null;
    if (oldBytes?.equals(newBytes ?? Buffer.alloc(0)) || (!oldBytes && !newBytes)) continue;
    const old = oldBytes?.toString('utf8') ?? ''; const fresh = newBytes?.toString('utf8') ?? '';
    changes.push({ path, before: old, after: fresh, originalHash: oldBytes ? sha256(oldBytes) : null, hash: newBytes ? sha256(newBytes) : null });
    const a = old.replace(/\n$/, '').split('\n'); const b = fresh.replace(/\n$/, '').split('\n');
    patch += `diff --git a/${path} b/${path}\n--- ${oldBytes ? `a/${path}` : '/dev/null'}\n+++ ${newBytes ? `b/${path}` : '/dev/null'}\n@@ -${oldBytes ? '1,' + a.length : '0,0'} +${newBytes ? '1,' + b.length : '0,0'} @@\n`;
    if (oldBytes) patch += a.map(line => `-${line}\n`).join('');
    if (newBytes) patch += b.map(line => `+${line}\n`).join('');
  }
  return { patch, changes };
}
