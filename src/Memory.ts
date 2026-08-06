import type { Message, TodoItem, Todolist } from "@llm4ts/flow/BasecampTool"
import { htmlToText } from "./Board.ts"
import { CardKind } from "./Protocol.ts"

// The agency's memory and policy, read from Basecamp (grilling
// 2026-08-05): lessons are message-board posts titled with the card-kind
// grammar; policy is CEO-editable todolists named "Policy: <stage>
// [kind]". Dwight injects both deterministically — no LLM decides what
// to remember, the CEO curates by archiving messages and editing lists.

const kindValues: ReadonlyArray<string> = CardKind.literals

const tagOf = (title: string): string | undefined =>
  /^\[([a-z]+)\]\s/.exec(title.trim())?.[1]

export const matchesKind = (title: string, kind: string): boolean => {
  const tag = tagOf(title)
  return tag === "all" || tag === kind
}

// Newest N lessons whose title tag matches the card kind (or [all]),
// rendered for prompt injection. undefined when nothing applies.
export const lessonsSection = (
  messages: ReadonlyArray<Message>,
  kind: string,
  limit: number
): string | undefined => {
  if (limit <= 0) {
    return undefined
  }
  const matching = messages.filter((message) => matchesKind(message.title, kind)).slice(-limit)
  if (matching.length === 0) {
    return undefined
  }
  return [
    "## Lessons on file (from earlier cards — follow them)",
    ...matching.map(
      (message) => `- ${message.title}\n  ${htmlToText(message.contentHtml).replace(/\n+/g, " ")}`
    )
  ].join("\n")
}

export interface PolicyName {
  readonly stage: string
  readonly kind: string
}

export const parsePolicyName = (title: string): PolicyName | undefined => {
  const match = /^Policy:\s*([a-z-]+)\s*\[([a-z]+)\]\s*$/i.exec(title.trim())
  const stage = match?.[1]?.toLowerCase()
  const kind = match?.[2]?.toLowerCase()
  return stage !== undefined &&
    kind !== undefined &&
    (kind === "all" || kindValues.includes(kind))
    ? { stage, kind }
    : undefined
}

// Every item from the scenario's matching policy lists ([kind] plus
// [all]), rendered as a rubric. undefined when no policy applies.
export const rubricSection = (
  lists: ReadonlyArray<readonly [Todolist, ReadonlyArray<TodoItem>]>,
  stage: string,
  kind: string
): string | undefined => {
  const items = lists.flatMap(([list, todos]) => {
    const policy = parsePolicyName(list.title)
    return policy !== undefined &&
      policy.stage === stage.toLowerCase() &&
      (policy.kind === "all" || policy.kind === kind)
      ? todos.map((todo) => todo.title)
      : []
  })
  if (items.length === 0) {
    return undefined
  }
  return [
    "## Policy rubric (every item must be satisfied)",
    ...items.map((item) => `- ${item}`)
  ].join("\n")
}

// --- Jim's lesson distillation replies ---

export interface Lesson {
  readonly title: string
  readonly body: string
}

export const parseLesson = (reply: string): Lesson | undefined => {
  const title = /TITLE\s*:?\s*\**\s*(.+)/i.exec(reply)?.[1]?.trim().replace(/\*+$/, "").trim()
  const body = /LESSON\s*:?\s*\**\s*([\s\S]+)/i.exec(reply)?.[1]?.trim()
  if (title === undefined || body === undefined || body.length === 0) {
    return undefined
  }
  const tag = tagOf(title)
  return tag !== undefined && (tag === "all" || kindValues.includes(tag))
    ? { title, body }
    : undefined
}

export const distillPrompt = (
  cardTitle: string,
  findingsHistory: string,
  kind: string
): string =>
  [
    "You are Jim Halpert. A card just parked at the draft-attempt cap.",
    "Distill ONE reusable lesson for the office's memory — the single",
    "most preventable mistake in this card's history, phrased so the next",
    "maker avoids it. Not a postmortem of this card; a rule for future ones.",
    "",
    `## Card: ${cardTitle}`,
    "",
    "## QA findings history",
    findingsHistory,
    "",
    "Reply with exactly:",
    "",
    `TITLE: [${kind}] <imperative rule, under 80 chars>`,
    "LESSON: <2-4 sentences: the mistake, why it fails QA, what to do instead>",
    "",
    "Use tag [all] instead if the lesson applies to every channel."
  ].join("\n")
