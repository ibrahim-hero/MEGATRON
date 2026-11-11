import { createHash } from 'node:crypto';
import type { Store, Trigger, OutboxMessage, Ticket } from '../core/ports.ts';
import type { MegatronSettings } from '../policy.ts';
import { key } from '../core/ids.ts';
import { runProcess } from '../infra/process.ts';
import type { ChannelSender } from '../outbox.ts';
export type GhTransport = (endpoint: string, method?: string, body?: Record<string, unknown>) => Promise<any>;
export function ghTransport(cwd: string, cli = process.env.MEGATRON_GH ?? 'gh'): GhTransport {
  return async (endpoint, method = 'GET', body) => {
    const args = [cli, 'api', '--method', method, endpoint];
    if (body) for (const [name, value] of Object.entries(body)) args.push(typeof value === 'string' ? '-f' : '-F', `${name}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
    // Nested JSON requires --input rather than form fields.
    if (body && Object.values(body).some(v => v && typeof v === 'object')) {
      const { writeFile } = await import('node:fs/promises'); const { join } = await import('node:path');
      const path = join(cwd, `.tmp-gh-${key(endpoint, Date.now())}.json`); await writeFile(path, JSON.stringify(body));
      const r = await runProcess(cwd, [cli, 'api', '--method', method, endpoint, '--input', path], { inheritEnv: true });
      const { unlink } = await import('node:fs/promises'); await unlink(path).catch(() => {});
      if (r.exitCode) throw new Error(`GitHub API failed: ${r.stderr.slice(0, 500)}`); return JSON.parse(r.stdout);
    }
    const r = await runProcess(cwd, args, { inheritEnv: true, timeoutMs: 30000 }); if (r.exitCode) throw new Error(`GitHub API failed: ${r.stderr.slice(0, 500)}`); return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  };
}
export function githubTrigger(comment: any, repository: string, account: string): Trigger | undefined {
  if (!comment?.id || !comment.user?.login || comment.user.login.toLowerCase() === account.toLowerCase()) return;
  const number = Number(String(comment.issue_url ?? comment.pull_request_url ?? '').split('/').at(-1)); if (!number) return;
  const thread = `github:${repository}:${number}`; const text = String(comment.body ?? '');
  return { id: key('github', comment.id, comment.updated_at ?? comment.created_at), source: 'github', threads: [thread], actor: { source: 'github', id: comment.user.login }, human: comment.user.type !== 'Bot', addressed: text.toLowerCase().includes(`@${account.toLowerCase()}`) ? 'mention' : undefined, at: comment.updated_at ?? comment.created_at, text, channel: { source: 'github', thread, address: { repository, number } }, meta: { githubRepository: repository, number, url: comment.html_url } };
}
export class GithubSource implements ChannelSender {
  store: Store; config: NonNullable<MegatronSettings['sources']['github']>; api: GhTransport;
  private identityChecked = false;
  constructor(store: Store, config: NonNullable<MegatronSettings['sources']['github']>, api: GhTransport) { this.store = store; this.config = config; this.api = api; }
  private async checkIdentity() { if(this.identityChecked)return;const user=await this.api('user');if(String(user.login).toLowerCase()!==this.config.account.toLowerCase())throw new Error('GitHub CLI identity does not match the configured source account');this.identityChecked=true; }
  async poll(receive: (t: Trigger) => void, repositoryId: string) {
    await this.checkIdentity();
    const cursor = this.store.getValue<string>('github:cursor') ?? new Date(Date.now() - 3600000).toISOString(); const started = new Date(Date.now() - 5000).toISOString();
    let page = 1;
    while (page <= 20) {
      const rows = await this.api(`repos/${this.config.repository}/issues/comments?since=${encodeURIComponent(cursor)}&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('Malformed GitHub comments response');
      for (const item of rows) { const trigger = githubTrigger(item, this.config.repository, this.config.account); if (trigger?.text) { trigger.meta.repository = repositoryId; receive(trigger); } }
      if (rows.length < 100) break; page++;
    }
    this.store.setValue('github:cursor', started);
  }
  async send(m: OutboxMessage): Promise<'sent' | 'gone'> {
    await this.checkIdentity();
    const repo = String(m.channel.address.repository); const number = Number(m.channel.address.number);
    if (repo !== this.config.repository || !number) return 'gone';
    const marker = `<!-- megatron:${m.id} -->`;
    const rows = await this.api(`repos/${repo}/issues/${number}/comments?per_page=100`);
    if (Array.isArray(rows) && rows.some(c => String(c.body).includes(marker))) return 'sent';
    await this.api(`repos/${repo}/issues/${number}/comments`, 'POST', { body: `*MEGATRON automated agent*\n\n${m.text}\n\n${marker}` }); return 'sent';
  }
}
/** Repository-scoped, receipt-driven PR creation; it is invoked only by a decided action gate. */
export class GithubDelivery {
  api: GhTransport; store: Store;
  constructor(api: GhTransport, store: Store) { this.api = api; this.store = store; }
  async publish(t: Ticket, repository: string, changes: { path: string; after: string; originalHash: string | null; hash: string | null; contentBase64?: string }[], baseBranch = 'main') {
    const saved = this.store.get<any>('github-delivery', t.id); if (saved?.url && saved.fingerprint === t.verifiedFingerprint) return saved;
    const branch = `megatron/${t.id}`;
    const ref = await this.api(`repos/${repository}/git/ref/heads/${baseBranch}`); const base = await this.api(`repos/${repository}/git/commits/${ref.object.sha}`);
    if (saved?.baseSha && saved.baseSha !== ref.object.sha) throw new Error('The base branch moved; rebase and re-verify before publishing a revision');
    for (const file of changes) if (file.originalHash) {
      const remote = await this.api(`repos/${repository}/contents/${file.path}?ref=${encodeURIComponent(baseBranch)}`);
      const hash = createHash('sha256').update(Buffer.from(remote.content, 'base64')).digest('hex'); if (hash !== file.originalHash) throw new Error(`Upstream changed ${file.path}; rebase and re-verify`);
    }
    for (const file of changes.filter(f=>!f.originalHash&&f.hash)) { try { await this.api(`repos/${repository}/contents/${file.path}?ref=${encodeURIComponent(baseBranch)}`); throw new Error(`Upstream already has ${file.path}; rebase and re-verify`); } catch(e) { if(!String(e).includes('404'))throw e; } }
    let head: any;
    try { head = await this.api(`repos/${repository}/git/ref/heads/${branch}`); } catch (e) { if (!String(e).includes('404')) throw e; }
    if (head && saved?.sha && head.object.sha !== saved.sha) throw new Error('Another actor changed the delivery branch; inspect it before proceeding');
    if (head && !saved) {
      const oldCommit = await this.api(`repos/${repository}/git/commits/${head.object.sha}`);
      if (!String(oldCommit.message).includes(`Ticket ${t.id}`)) throw new Error('Existing delivery branch has no matching ownership receipt');
    }
    let sha = head?.object.sha;
    if (!head || saved?.fingerprint !== t.verifiedFingerprint) {
      const treeFiles = [];
      for (const file of changes) {
        if (file.hash === null) treeFiles.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
        else { const blob = await this.api(`repos/${repository}/git/blobs`, 'POST', { content: file.contentBase64 ?? file.after, encoding: file.contentBase64 ? 'base64' : 'utf-8' }); treeFiles.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha }); }
      }
      const tree = await this.api(`repos/${repository}/git/trees`, 'POST', { base_tree: base.tree.sha, tree: treeFiles });
      const commit = await this.api(`repos/${repository}/git/commits`, 'POST', { message: `MEGATRON: ${t.title}\n\nTicket ${t.id}`, tree: tree.sha, parents: [sha ?? ref.object.sha] }); sha = commit.sha;
      if (head) await this.api(`repos/${repository}/git/refs/heads/${branch}`, 'PATCH', { sha, force: false });
      else await this.api(`repos/${repository}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha });
    }
    this.store.save('github-delivery', t.id, { ...saved, branch, sha, fingerprint: t.verifiedFingerprint, baseSha: ref.object.sha });
    const body = `MEGATRON ticket ${t.id}\n\nVerified local tree: ${t.verifiedFingerprint}\n\nChecks: ${t.criteria.map(c => c.label).join(', ')}`;
    const open = await this.api(`repos/${repository}/pulls?head=${encodeURIComponent(repository.split('/')[0] + ':' + branch)}&state=open`);
    const existing = Array.isArray(open) ? open[0] : undefined;
    const pr = existing ? await this.api(`repos/${repository}/pulls/${existing.number}`, 'PATCH', { title: t.title, body }) : await this.api(`repos/${repository}/pulls`, 'POST', { title: t.title, head: branch, base: baseBranch, body });
    const result = { url: pr.html_url, number: pr.number, sha, repository, branch, fingerprint: t.verifiedFingerprint, baseSha: ref.object.sha }; this.store.save('github-delivery', t.id, result); return result;
  }
  async merge(t: Ticket) {
    const delivery = this.store.get<any>('github-delivery', t.id); if (!delivery?.number) throw new Error('No pull request was published for this ticket');
    const pr = await this.api(`repos/${delivery.repository}/pulls/${delivery.number}`);
    if (pr.head.sha !== delivery.sha || pr.state !== 'open' || pr.additions + pr.deletions >= 200) throw new Error('The PR changed, is closed, or exceeds the configured small-change merge policy');
    const reviews = await this.api(`repos/${delivery.repository}/pulls/${delivery.number}/reviews`);
    if (!reviews.some((r: any) => r.state === 'APPROVED' && r.commit_id === pr.head.sha)) throw new Error('An approval covering the current head commit is required');
    const checks = await this.api(`repos/${delivery.repository}/commits/${pr.head.sha}/check-runs`);
    if (checks.check_runs.some((c: any) => c.status !== 'completed' || !['success', 'skipped', 'neutral'].includes(c.conclusion))) throw new Error('CI is not green');
    const result = await this.api(`repos/${delivery.repository}/pulls/${delivery.number}/merge`, 'PUT', { sha: delivery.sha, merge_method: 'squash' }); if (!result.merged) throw new Error('GitHub refused the merge'); return result;
  }
}
