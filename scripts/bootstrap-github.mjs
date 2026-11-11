import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// Portable tooling and authentication configuration stay on the project drive.
const root = resolve('tools/github');
await mkdir(root, { recursive: true });
const release = await (await fetch('https://api.github.com/repos/cli/cli/releases/latest')).json();
const asset = release.assets.find(a => /windows_amd64\.zip$/.test(a.name));
if (!asset) throw new Error('Windows GitHub CLI asset missing.');
const bytes = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer());
if (asset.digest && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) throw new Error('GitHub CLI checksum mismatch.');
const archive = resolve(root, asset.name);
await writeFile(archive, bytes);
const quote = s => `'${s.replaceAll("'", "''")}'`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(root)} -Force`], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Portable GitHub CLI extraction failed.');
console.log(`GitHub CLI installed under ${root}`);
