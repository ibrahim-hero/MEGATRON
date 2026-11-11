import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Store } from '../core/ports.ts';
import { validateSettings, DEFAULT_SETTINGS, type MegatronSettings } from '../policy.ts';
export class SettingsManager {
  current: MegatronSettings; revision: number; path: string; store: Store;
  constructor(store: Store, stateDir: string, settings: MegatronSettings) { this.store = store; this.path = join(stateDir, 'settings.json'); this.current = validateSettings(settings); this.revision = store.getValue<number>('settingsRevision') ?? 0; }
  static async load(store: Store, stateDir: string, initial?: MegatronSettings) {
    const path = join(stateDir, 'settings.json'); await mkdir(stateDir, { recursive: true });
    const value = initial ?? (existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : DEFAULT_SETTINGS);
    const manager = new SettingsManager(store, stateDir, value); if (!existsSync(path)) await writeFile(path, JSON.stringify(manager.current, null, 2)); return manager;
  }
  async save(value: unknown, revision: number) {
    if (revision !== this.revision) throw new Error('Settings changed; refresh and merge your draft');
    const next = validateSettings(value); await writeFile(`${this.path}.tmp`, JSON.stringify(next, null, 2)); await rename(`${this.path}.tmp`, this.path);
    this.store.atomic(() => { this.current = next; this.revision++; this.store.setValue('settingsRevision', this.revision); this.store.save('settings-version', String(this.revision), { revision: this.revision, value: next, at: new Date().toISOString() }); this.store.events.append('settings.changed', { revision: this.revision }); }); return this.revision;
  }
}
