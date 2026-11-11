/** A refusal a caller can cause; the API answers 400/404 and the CLI prints it. */
export class UserError extends Error {
  code: string
  values: Record<string, string>
  constructor(code: string, values: Record<string, string> = {}) {
    super(code)
    this.name = "UserError"
    this.code = code
    this.values = values
  }
}

export const USER_ERRORS: Record<string, { status: number; text: string }> = {
  unknownTicket: { status: 404, text: "No such ticket" },
  unknownTrigger: { status: 404, text: "No such trigger" },
  unknownApproval: { status: 404, text: "No such approval" },
  ticketEnded: { status: 400, text: "Ticket has ended" },
  ticketStopped: { status: 400, text: "Ticket was stopped by a person" },
  notAllowed: { status: 400, text: "Not allowed by the current policy" },
  invalidReport: { status: 400, text: "Invalid report" },
  evidenceFailed: { status: 400, text: "Evidence check failed; ticket is not ready" },
  approvalPending: { status: 400, text: "An approval is pending; decide it first" },
  nothingToRetry: { status: 400, text: "Ticket is not in a retryable state" },
  badConfig: { status: 400, text: "Invalid configuration" },
}
