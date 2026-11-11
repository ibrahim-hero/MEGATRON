import { readFile } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';
import type { SqliteStore } from '../store/store.ts';
import type { Ticket } from '../core/model.ts';
import { files, sha256 } from '../infra/files.ts';
export interface KnowledgeDocument { id: string; repository: string; path: string; title: string; content: string; hash: string; symbols: string[]; imports: string[]; vector: number[]; indexedAt: string }
export interface KnowledgeFact { id: string; repository: string; text: string; source: { path?: string; hash?: string; ticketId?: string; fingerprint?: string }; freshness: 'fresh' | 'stale'; at: string }
const words = (text: string) => text.toLowerCase().match(/[a-z][a-z0-9_]{1,}/g) ?? [];
/** Deterministic offline vector fallback; injectable neural embeddings use the same search path. */
export function localVector(text: string): number[] {
  const v = Array<number>(96).fill(0);
  const aliases: Record<string, string> = { authentication: 'auth', authorization: 'auth', login: 'auth', payment: 'checkout', purchase: 'checkout', error: 'failure', bug: 'failure', latency: 'performance', slow: 'performance' };
  for (const w of words(text)) { const word = aliases[w] ?? w; const i = parseInt(sha256(word).slice(0, 4), 16) % v.length; v[i] += 1; }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1; return v.map(n => n / norm);
}
const cosine = (a: number[], b: number[]) => a.reduce((s, n, i) => s + n * (b[i] ?? 0), 0);
export class KnowledgeIndex {
  store: SqliteStore; embed: (text: string) => Promise<number[]>;
  constructor(store: SqliteStore, embed?: (text: string) => Promise<number[]>) { this.store = store; this.embed = embed ?? (async t => localVector(t)); }
  async index(repository: string, root: string) {
    const seen = new Set<string>(); let changed = 0;
    for (const path of await files(root)) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|md|txt|json|ya?ml|css|html)$/.test(path)) continue;
      const bytes = await readFile(join(root, path)); if (bytes.length > 256000) continue;
      const hash = sha256(bytes); const id = `${repository}:${path}`; seen.add(id);
      if (this.store.get<KnowledgeDocument>('document', id)?.hash === hash) continue;
      const content = bytes.toString('utf8');
      const doc: KnowledgeDocument = { id, repository, path, title: path.split('/').at(-1)!, hash, content, symbols: [...content.matchAll(/\b(?:function|class|interface|type|def|fn|const)\s+(\w+)/g)].map(m => m[1]), imports: [...content.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]), vector: await this.embed(content.slice(0, 16000)), indexedAt: new Date().toISOString() };
      this.store.atomic(() => { this.store.save('document', id, doc); this.store.run('DELETE FROM knowledge_fts WHERE id=?', id); this.store.run('INSERT INTO knowledge_fts VALUES(?,?,?,?,?)', id, repository, path, doc.title, content); }); changed++;
    }
    for (const doc of this.store.list<KnowledgeDocument>('document').filter(d => d.repository === repository && !seen.has(d.id))) { this.store.remove('document', doc.id); this.store.run('DELETE FROM knowledge_fts WHERE id=?', doc.id); changed++; }
    this.refreshFacts(repository);
    return { files: seen.size, changed, repository };
  }
  refreshFacts(repository: string) {
    for (const fact of this.store.list<KnowledgeFact>('fact').filter(f => f.repository === repository && f.source.path)) {
      const doc = this.store.get<KnowledgeDocument>('document', `${repository}:${fact.source.path}`);
      fact.freshness = doc?.hash === fact.source.hash ? 'fresh' : 'stale'; this.store.save('fact', fact.id, fact);
    }
  }
  async search(query: string, repository?: string, limit = 8) {
    if (!query.trim()) return [];
    const terms = words(query).map(w => `"${w}"`).join(' OR '); if (!terms) return [];
    const matched = this.store.query('SELECT id,bm25(knowledge_fts) AS rank FROM knowledge_fts WHERE knowledge_fts MATCH ? LIMIT 30', terms) as { id: string; rank: number }[];
    const lexical = new Set(matched.map(m => m.id)); const vector = await this.embed(query);
    const docs = this.store.list<KnowledgeDocument>('document').filter(d => !repository || d.repository === repository).map(d => ({ id: d.id, repository: d.repository, path: d.path, hash: d.hash, title: d.title, snippet: d.content.slice(0, 500), symbols: d.symbols, score: cosine(vector, d.vector) + (lexical.has(d.id) ? 0.5 : 0), freshness: 'fresh' as const, source: { path: d.path, hash: d.hash } }));
    const facts = this.store.list<KnowledgeFact>('fact').filter(f => f.freshness === 'fresh' && (!repository || f.repository === repository)).map(f => ({ id: f.id, repository: f.repository, path: f.source.path ?? `ticket/${f.source.ticketId}`, hash: f.source.hash ?? f.source.fingerprint ?? '', title: 'Verified task memory', snippet: f.text, symbols: [] as string[], score: cosine(vector, localVector(f.text)), freshness: f.freshness, source: f.source }));
    return [...docs, ...facts].sort((a, b) => b.score - a.score).slice(0, limit);
  }
  graph(repository?: string) {
    const docs = this.store.list<KnowledgeDocument>('document').filter(d => !repository || d.repository === repository);
    const nodes = docs.map(d => ({ id: d.id, label: d.path, symbols: d.symbols }));
    const edges: { from: string; to: string; type: string }[] = [];
    for (const d of docs) for (const spec of d.imports.filter(i => i.startsWith('.'))) {
      const path = posix.normalize(posix.join(dirname(d.path).split('\\').join('/'), spec));
      const target = docs.find(t => t.repository === d.repository && [path, path + '.ts', path + '.js', path + '/index.ts', path.replace(/\.js$/, '.ts')].includes(t.path));
      if (target) edges.push({ from: d.id, to: target.id, type: 'imports' });
    }
    return { nodes, edges };
  }
  impact(repository: string, path: string) {
    const graph = this.graph(repository); const affected = new Set([`${repository}:${path}`]); let last = 0;
    while (last !== affected.size) { last = affected.size; for (const e of graph.edges) if (affected.has(e.to)) affected.add(e.from); }
    return graph.nodes.filter(n => affected.has(n.id));
  }
  addFact(fact: Omit<KnowledgeFact, 'id' | 'freshness' | 'at'>) {
    if (!(fact.source.path && fact.source.hash) && !(fact.source.ticketId && fact.source.fingerprint)) throw new Error('Knowledge facts require a source and immutable revision');
    const row: KnowledgeFact = { ...fact, id: sha256(JSON.stringify(fact)), freshness: 'fresh', at: new Date().toISOString() }; this.store.save('fact', row.id, row); return row;
  }
  learn(t: Ticket) {
    if (!t.verifiedFingerprint || !t.delivery) return;
    return this.addFact({ repository: t.repository, text: `Verified task: ${t.title}. Checks: ${t.criteria.map(c => c.label).join(', ')}. Delivered files: ${t.delivery.manifest.join(', ')}. This is historical delivery evidence, not an assertion about the repository's current branch.`, source: { ticketId: t.id, fingerprint: t.verifiedFingerprint } });
  }
}
