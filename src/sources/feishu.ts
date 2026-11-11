import type { Trigger, OutboxMessage } from '../core/ports.ts';
import type { MegatronSettings } from '../policy.ts';
import { key } from '../core/ids.ts';
export function feishuTrigger(payload: any, botId: string): Trigger | undefined {
  const event = payload.event; const message = event?.message; const sender = event?.sender?.sender_id?.open_id;
  if (!message?.message_id || !sender || sender === botId || message.message_type !== 'text') return;
  let content; try { content = JSON.parse(message.content); } catch { return; }
  const thread = `feishu:${message.chat_id}:${message.root_id || message.message_id}`;
  return { id: key('feishu', message.message_id), source: 'feishu', threads: [thread], actor: { source: 'feishu', id: sender }, human: event.sender.sender_type === 'user', addressed: message.mentions?.some((m: any) => m.id?.open_id === botId) ? 'mention' : message.chat_type === 'p2p' ? 'direct' : undefined, at: new Date(Number(message.create_time)).toISOString(), text: content.text ?? '', channel: { source: 'feishu', thread, address: { messageId: message.message_id, chatId: message.chat_id } }, meta: { chatId: message.chat_id } };
}
export class FeishuChannel {
  config: NonNullable<MegatronSettings['sources']['feishu']>; fetcher: typeof fetch; private token?: string; private expires = 0;
  constructor(config: NonNullable<MegatronSettings['sources']['feishu']>, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher; }
  async send(m: OutboxMessage): Promise<'sent' | 'gone'> {
    if (!this.config.chats.includes(String(m.channel.address.chatId))) return 'gone';
    if (!this.token || this.expires < Date.now()) {
      const secret = process.env[this.config.appSecretEnv]; if (!secret) throw new Error(`Set ${this.config.appSecretEnv}`);
      const r = await this.fetcher('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: this.config.appId, app_secret: secret }) });
      const data = await r.json() as any; if (!r.ok || data.code !== 0) throw new Error('Feishu authentication failed'); this.token = data.tenant_access_token; this.expires = Date.now() + (data.expire - 60) * 1000;
    }
    const r = await this.fetcher(`https://open.feishu.cn/open-apis/im/v1/messages/${m.channel.address.messageId}/reply`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify({ content: JSON.stringify({ text: m.text }), msg_type: 'text', uuid: m.id }) });
    const data = await r.json() as any; if (data.code === 230011) return 'gone'; if (!r.ok || data.code !== 0) throw new Error('Feishu delivery failed'); return 'sent';
  }
}
