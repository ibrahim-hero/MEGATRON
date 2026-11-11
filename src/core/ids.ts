import { createHash } from "node:crypto"

/** Deterministic id from its inputs: equal inputs give equal ids (idempotence). */
export function key(...parts: (string | number | undefined)[]): string {
  const h = createHash("sha1").update(parts.map((p) => String(p ?? "")).join("\0")).digest("hex")
  return h.slice(0, 12)
}

export function threadKey(source: string, id: string): string {
  return `${source}:${id}`
}
