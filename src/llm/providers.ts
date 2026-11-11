import { randomUUID } from 'node:crypto';
import type { Provider, ModelReply, Message, ScenarioStep, ToolCall, ToolSpec } from '../core/ports.ts';
import type { ModelConfig } from '../policy.ts';
export class ScriptedProvider implements Provider {
  model = 'scripted-demo'; steps: ScenarioStep[];
  constructor(steps: ScenarioStep[]) { this.steps = structuredClone(steps); }
  async complete(input: { messages: Message[] }): Promise<ModelReply> {
    const step = input.messages.filter(m => m.role === 'assistant').length;
    const reply = this.steps[step]; if (!reply) throw new Error('Scripted demonstration exhausted; a real request needs a configured provider');
    return { text: reply.text ?? '', toolCalls: reply.toolCalls?.map((c, i) => ({ ...c, id: `demo-${step}-${i}` })), usage: { inputTokens: 120 + step * 10, outputTokens: 60 }, model: this.model };
  }
}
export class HttpProvider implements Provider {
  model: string; config: ModelConfig;
  constructor(config: ModelConfig) { this.config = config; this.model = config.model; }
  async complete(input: { system: string; messages: Message[]; tools: ToolSpec[]; signal?: AbortSignal }): Promise<ModelReply> {
    const anthropic = this.config.provider === 'anthropic';
    const base = (this.config.baseUrl ?? (anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com')).replace(/\/$/, '');
    const suffix = anthropic ? 'messages' : 'chat/completions';
    const url = `${base}${base.endsWith('/v1') ? '' : '/v1'}/${suffix}`;
    const apiKey = process.env[this.config.apiKeyEnv ?? (anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')];
    if (!apiKey && !/^(http:\/\/(127\.0\.0\.1|localhost|\[::1\]))/.test(url)) throw new Error(`Set ${this.config.apiKeyEnv ?? (anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY')} in your terminal`);
    const body = anthropic ? {
      model: this.model, max_tokens: 4096, system: input.system,
      messages: input.messages.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.text }] : [...(m.text ? [{ type: 'text', text: m.text }] : []), ...(m.toolCalls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] })),
      tools: input.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    } : {
      model: this.model, messages: [{ role: 'system', content: input.system }, ...input.messages.map(m => ({ role: m.role, content: m.text || (m.role === 'assistant' ? null : ''), ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) }))],
      tools: input.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    };
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? (anthropic ? { 'x-api-key': apiKey } : { authorization: `Bearer ${apiKey}` }) : {}), ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(body), signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
      if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await response.text(); await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
    if (!response?.ok) throw new Error(`Model provider returned HTTP ${response?.status ?? 'unavailable'}`);
    const data = await response.json() as any;
    let text = ''; const calls: ToolCall[] = [];
    if (anthropic) {
      for (const part of data.content ?? []) { if (part.type === 'text') text += part.text; if (part.type === 'tool_use') calls.push({ id: part.id, name: part.name, args: part.input }); }
    } else {
      const msg = data.choices?.[0]?.message; if (!msg) throw new Error('Provider response has no completion'); text = msg.content ?? '';
      for (const c of msg.tool_calls ?? []) { let args; try { args = JSON.parse(c.function.arguments); } catch { throw new Error('Provider returned malformed tool arguments'); } calls.push({ id: c.id ?? randomUUID(), name: c.function.name, args }); }
    }
    return { text, toolCalls: calls, usage: { inputTokens: Number(anthropic ? data.usage?.input_tokens ?? 0 : data.usage?.prompt_tokens ?? 0), outputTokens: Number(anthropic ? data.usage?.output_tokens ?? 0 : data.usage?.completion_tokens ?? 0) }, model: this.model };
  }
}
