/** Domain facts. No filesystem, network, process, or provider dependencies. */
export type Strength = 'explicit' | 'inferred';
export type ReportState = 'progress' | 'ready' | 'blocked' | 'failed' | 'dropped';
export type TicketStage = 'queued' | 'working' | 'verifying' | 'needs-you' | 'waiting' | 'ended';
export type TicketOutcome = 'completed' | 'delivered' | 'merged' | 'dropped' | 'stopped' | 'failed';
export interface ChannelRef { source: string; thread: string; address: Record<string, unknown> }
export interface Trigger {
  id: string; source: string; threads: string[]; actor: { source: string; id: string };
  human: boolean; addressed?: 'mention' | 'direct'; at: string; text: string;
  channel: ChannelRef; meta: Record<string, unknown>;
}
export interface Eval { id: string; triggerIds: string[]; state: 'queued' | 'assessing'; version: string; attempts: number; deadline?: number }
export interface Thread {
  key: string; source: string; id: string; triggers: string[]; queued: string[];
  decisions: string[]; subscriptions: { ticketId: string; context?: boolean }[]; eval?: Eval;
}
export interface Decision {
  id: string; triggerId: string; evalId?: string; kind: 'accept' | 'stop' | 'ignore' | 'unavailable';
  reason: string; ticketId?: string; rules?: string[]; audit?: Record<string, unknown>; at: string;
}
export interface Mandate {
  policyVersion: string; strength: Strength; basis: string; scope: string; sender: string;
  source: string; rules: string[]; request: string; stopped?: boolean;
}
export interface VerifyCommand {
  id: string; label: string; command: string; timeoutMs: number; regression?: boolean;
}
export interface Checkpoint {
  plan?: string[]; facts?: string[]; externalActions?: string[]; nextStep?: string;
  workspace?: { fingerprint?: string; branch?: string; lastCommit?: string };
  step?: number; transcript?: Message[]; savedAt?: string;
}
export interface Report {
  state: ReportState; summary: string; question?: string | null; evidenceIds?: string[];
  checkpoint?: Checkpoint; at: string;
}
export interface Evidence {
  id: string; runId: string; ticketId: string; criterion: string; command: string;
  status: 'pass' | 'fail' | 'error'; exitCode: number; output: string; at: string;
  fingerprint: string; environment: string; durationMs: number; baseline?: boolean;
}
export interface Approval {
  id: string; ticketId: string; kind: 'delivery' | 'merge' | 'deploy' | 'side-effect';
  summary: string; risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'expired'; fingerprint: string;
  decidedBy?: string; decidedAt?: string; expiresAt: string; payload?: Record<string, unknown>;
}
export interface LedgerEntry {
  id: string; ticketId?: string; kind: 'tokens' | 'cost' | 'message' | 'attention' | 'humanInput' | 'duration';
  amount: number; detail?: string; at: string; model?: string;
}
export interface Assignment {
  id: string; state: 'pending' | 'running' | 'ended'; report?: Report; checkpoint?: Checkpoint;
  startedAt?: string; endedAt?: string; interrupted?: boolean; workerNotes?: string[];
}
export interface Input {
  id: string; kind: 'trigger' | 'note' | 'policy' | 'resume'; triggerId?: string;
  text?: string; human?: boolean; deliveredAt?: string; readAt?: string;
}
export interface Delivery { directory: string; fingerprint: string; patch: string; at: string; pullUrl?: string; manifest: string[] }
export interface Ticket {
  id: string; title: string; shortName: string; repository: string; state: 'open' | 'ended';
  mandate: Mandate; channel: ChannelRef; threadKey: string; stage: TicketStage;
  assignments: Assignment[]; inputs: Input[]; evidence: Evidence[]; approvals: Approval[];
  criteria: VerifyCommand[]; verifiedFingerprint?: string; verificationRun?: string;
  attention?: { id: string; question: string; askedAt: string };
  scenario?: string; workflowId?: string; delivery?: Delivery;
  createdAt: string; updatedAt: string; ended?: { at: string; by: string; outcome: TicketOutcome; reason?: string };
}
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface Message { role: 'user' | 'assistant' | 'tool'; text: string; toolCalls?: ToolCall[]; toolCallId?: string }
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ModelReply { text: string; toolCalls?: ToolCall[]; usage: { inputTokens: number; outputTokens: number }; model: string }
export interface ScenarioStep { text?: string; toolCalls?: Omit<ToolCall, 'id'>[] }
export interface RunResult { exitCode: number; stdout: string; stderr: string; durationMs: number }
export interface OutboxMessage {
  id: string; ticketId?: string; channel: ChannelRef; text: string;
  kind: 'acknowledgement' | 'reply' | 'notice' | 'result';
  status: 'pending' | 'sent' | 'dropped'; attempts: number; createdAt: string; queuedSeq: number;
  urgent?: boolean; settledAt?: string; dropReason?: string;
}
export interface EffectRow {
  id: string; kind: string; dedupeKey: string; payload: unknown;
  status: 'pending' | 'running' | 'done'; attempts: number; nextAttemptAt: number;
  leaseUntil: number; lastError?: string; seq: number;
}
export const liveTicket = (t: Ticket) => t.state === 'open';
export const latestAssignment = (t: Ticket) => t.assignments.at(-1);
export const runningAssignment = (t: Ticket) => t.assignments.findLast(a => a.state === 'running');
export const latestReport = (t: Ticket) => latestAssignment(t)?.report;
export const waitsForPerson = (t: Ticket) => !!t.attention || t.approvals.some(a => a.status === 'pending') || ['blocked', 'failed'].includes(latestReport(t)?.state ?? '');
export const hasGreenEvidence = (t: Ticket) => !!t.verifiedFingerprint && t.evidence.some(e => !e.baseline && e.status === 'pass' && e.fingerprint === t.verifiedFingerprint) && !t.evidence.some(e => e.runId === t.verificationRun && e.status !== 'pass');
