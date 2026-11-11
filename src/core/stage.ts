import type { Ticket } from "./model.ts"

/**
 * One stage per open ticket, first match wins (Vision doc Part I: honest state).
 * needs-you: the ticket cannot continue without a person.
 */
export function ticketStage(t: Ticket): Ticket["stage"] {
  if (t.state === "ended") return "ended"
  if (t.attention) return "needs-you"
  const pendingApproval = t.approvals.find((a) => a.status === "pending")
  if (pendingApproval) return "needs-you"
  const latest = t.assignments[t.assignments.length - 1]
  if (!latest || latest.state === "pending") return "queued"
  if (latest.state === "running") {
    const r = latest.report
    if (r && r.state === "ready") return "verifying"
    if (r && (r.state === "blocked" || r.state === "failed")) return "needs-you"
    return "working"
  }
  return "waiting"
}

export const STAGE_LABEL: Record<Ticket["stage"], string> = {
  working: "Working",
  queued: "Queued",
  "needs-you": "Needs you",
  waiting: "Waiting for a trigger",
  ended: "Ended",
  verifying: "Verifying evidence",
}
