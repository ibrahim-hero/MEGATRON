import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = [...globSync('tests/**/*.test.ts')].sort();
if (!files.length) throw new Error('No tests found.');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
