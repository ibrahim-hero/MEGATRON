import { createHash } from 'node:crypto';
import type { Policy, VerifyCommand } from './core/ports.ts';
import { UserError } from './core/errors.ts';

export interface RepositoryConfig { path: string; github?: string; verify: VerifyCommand[]; trustedTests?: string[]; baseBranch?: string }
export interface ModelConfig {
  id: string; provider: 'demo' | 'openai' | 'anthropic'; model: string; baseUrl?: string; apiKeyEnv?: string;
  pricePer1kInput: number; pricePer1kOutput: number; capabilities: string[];
}
export interface MegatronSettings {
  repositories: Record<string, RepositoryConfig>;
  policy: { acceptMode: 'auto' | 'observe'; paused: boolean; allowed: string[]; bots: string[]; sources: Record<string, { allowed: string[]; bots?: string[] }>; rules: { id: string; instruction: string }[]; gates: { delivery: boolean; merge: boolean; deploy: boolean } };
  executor: { maxWorkers: number; maxSteps: number; maxTokens: number; maxUsd: number; maxTimeMs: number; sandbox: 'local' | 'container'; image: string; blockedCommands: string[]; retryLimit: number };
  models: ModelConfig[];
  notifications: { enabled: boolean; quietHours?: { from: number; to: number }; digestSeconds: number; maxProgressMessages: number };
  sources: { github?: { repository: string; account: string; cli?: string; pollSeconds: number }; feishu?: { chats: string[]; appId: string; appSecretEnv: string; botId: string }; webhooks?: { secretEnv: string } };
  mcp: { id: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; enabled: boolean }[];
}
export const DEFAULT_SETTINGS: MegatronSettings = {
  repositories: {},
  policy: { acceptMode: 'observe', paused: false, allowed: ['operator'], bots: [], sources: {}, rules: [], gates: { delivery: true, merge: true, deploy: true } },
  executor: { maxWorkers: 2, maxSteps: 40, maxTokens: 150000, maxUsd: 10, maxTimeMs: 600000, sandbox: 'local', image: 'node:24-bookworm-slim', blockedCommands: [], retryLimit: 2 },
  models: [{ id: 'demo', provider: 'demo', model: 'scripted-demo', pricePer1kInput: 0, pricePer1kOutput: 0, capabilities: ['tools', 'offline'] }],
  notifications: { enabled: true, digestSeconds: 0, maxProgressMessages: 0 }, sources: {}, mcp: [],
};
export function validateSettings(raw: unknown): MegatronSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError('badConfig');
  const r = raw as Partial<MegatronSettings>;
  const s: MegatronSettings = {
    ...structuredClone(DEFAULT_SETTINGS), ...r,
    policy: { ...DEFAULT_SETTINGS.policy, ...r.policy, gates: { ...DEFAULT_SETTINGS.policy.gates, ...r.policy?.gates } },
    executor: { ...DEFAULT_SETTINGS.executor, ...r.executor },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...r.notifications },
    repositories: r.repositories ?? {}, models: r.models ?? structuredClone(DEFAULT_SETTINGS.models), sources: r.sources ?? {}, mcp: r.mcp ?? [],
  };
  const fail = (detail: string): never => { throw new UserError('badConfig', { detail }); };
  if (!['auto', 'observe'].includes(s.policy.acceptMode)) fail('acceptMode must be auto or observe');
  if (!Array.isArray(s.policy.allowed) || !s.policy.allowed.every(x => typeof x === 'string' && x.length)) fail('allowed must list identities');
  if (!Array.isArray(s.policy.bots) || !Array.isArray(s.policy.rules) || !s.policy.rules.every(x => x.id && x.instruction)) fail('invalid rules or bots');
  for (const part of Object.values(s.policy.sources)) if (!Array.isArray(part.allowed) || !part.allowed.every(x => typeof x === 'string')) fail('Source permissions need native sender identities');
  for (const [key, value] of Object.entries(s.executor)) if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) fail(`${key} must be positive`);
  if (s.executor.maxWorkers > 16 || !Number.isInteger(s.executor.maxWorkers)) fail('maxWorkers must be 1..16');
  if (!['local', 'container'].includes(s.executor.sandbox)) fail('invalid sandbox');
  for (const [id, repo] of Object.entries(s.repositories)) {
    if (!/^[\w-]+$/.test(id) || !repo.path || !Array.isArray(repo.verify) || !repo.verify.length) fail(`repository ${id} needs a path and verification commands`);
    for (const c of repo.verify) if (!c.id || !c.label || !c.command || !Number.isFinite(c.timeoutMs) || c.timeoutMs <= 0) fail(`invalid check in ${id}`);
    if (repo.github && !/^[\w.-]+\/[\w.-]+$/.test(repo.github)) fail('invalid GitHub repository');
  }
  if (!Array.isArray(s.models) || !s.models.length || new Set(s.models.map(m => m.id)).size !== s.models.length) fail('models need unique ids');
  for (const m of s.models) if (!m.id || !m.model || !['demo', 'openai', 'anthropic'].includes(m.provider) || !Array.isArray(m.capabilities) || m.pricePer1kInput < 0 || m.pricePer1kOutput < 0) fail('invalid model');
  return s;
}
export const policyVersion = (s: MegatronSettings) => `v${createHash('sha256').update(JSON.stringify(s.policy)).digest('hex').slice(0, 10)}`;
export function sourceAllows(s: MegatronSettings, source: string, id: string, human = true) {
  const part = s.policy.sources[source] ?? (['local','demo'].includes(source) ? { allowed: s.policy.allowed, bots: s.policy.bots } : { allowed: [], bots: [] });
  return (human ? part.allowed : part.bots ?? []).some(x => x.toLowerCase() === id.toLowerCase());
}
export function settingsPolicy(s: MegatronSettings): Policy {
  return {
    version: policyVersion(s), acceptMode: s.policy.acceptMode, paused: s.policy.paused,
    gate(t) {
      const allowed = sourceAllows(s,t.source,t.actor.id,t.human);
      if (t.human && t.addressed && allowed) return { admissible: true, strength: 'explicit', basis: 'addressed' };
      if (s.policy.rules.length && allowed) return { admissible: true, strength: 'inferred', basis: t.human ? 'admission' : 'bot' };
      return { admissible: false, reason: allowed ? 'no_matching_rule' : 'not_a_member' };
    },
    revalidate(m) { return !m.stopped && sourceAllows(s,m.source,m.sender,m.basis!=='bot') && (m.strength === 'explicit' || m.rules.every(id => s.policy.rules.some(r => r.id === id))); },
  };
}
