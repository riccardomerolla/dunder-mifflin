import * as Schema from "effect/Schema"

// The board protocol: columns are the state machine, the title prefix is
// the work type (cards have no labels), signed comments are the audit
// trail. Deterministic code only.

export const CardKind = Schema.Literals([
  "blog",
  "x",
  "li",
  "ig",
  "digest",
  "opportunity",
  "analysis",
  "suggestion",
  "product",
  "design"
])
export type CardKind = typeof CardKind.Type

const kindValues: ReadonlyArray<string> = CardKind.literals

export const parseKind = (title: string): CardKind | undefined => {
  const match = /^\[([a-z]+)\]\s+\S/.exec(title.trim())
  const raw = match?.[1]
  return raw !== undefined && kindValues.includes(raw) ? (raw as CardKind) : undefined
}

export const titled = (kind: CardKind, rest: string): string => `[${kind}] ${rest}`

export const stripKind = (title: string): string =>
  title.trim().replace(/^\[[a-z]+\]\s+/, "")

export const officeSignature = "· Dunder Mifflin"

export const signed = (character: string, body: string): string =>
  `${body}\n\n— ${character} ${officeSignature}`

export const isOfficeComment = (body: string): boolean => body.includes(officeSignature)

export type MakerSeat =
  | "ghostwriter"
  | "social"
  | "opportunityScout"
  | "trendScout"
  | "analyst"
  | "growthAdvisor"
  | "productOwner"
  | "productDesigner"

// Informational kinds (digest/opportunity/analysis/suggestion) have no
// maker: they are authored by scouts (Phase 2+) and read by the CEO.
export const makerSeatFor = (kind: CardKind): MakerSeat | undefined => {
  switch (kind) {
    case "blog":
      return "ghostwriter"
    case "x":
    case "li":
    case "ig":
      return "social"
    case "opportunity":
      return "opportunityScout"
    case "digest":
      return "trendScout"
    case "analysis":
      return "analyst"
    case "suggestion":
      return "growthAdvisor"
    case "product":
      return "productOwner"
    case "design":
      return "productDesigner"
  }
}

// A card body may declare a dependency: "Blocked-by: <card id>". Dwight
// refuses to claim the card until the blocker card reaches Done — the
// product pipeline's [design]-waits-for-[product] rule, and Nightcall's
// DEPENDS pattern in Basecamp clothes.
export const parseBlocker = (text: string): number | undefined => {
  const match = /Blocked-by:\s*#?(\d+)/i.exec(text)
  const id = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

// Machine-readable marker a maker leaves in its signed comment when the
// draft is complete; Jim's QA pass looks for it.
export const draftReadyMarker = "DRAFT-READY"

// Marker for an attempt that produced nothing parseable — it counts
// against the attempt cap like a real draft, because it cost like one.
export const draftFailedMarker = "DRAFT-FAILED"
