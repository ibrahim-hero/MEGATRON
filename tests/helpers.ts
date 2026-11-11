import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../tools/test-temp/', import.meta.url));
export async function temporary() { await mkdir(root, { recursive: true }); const dir = await mkdtemp(join(root, 'case-')); return { dir, dispose: () => rm(dir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 }) }; }
