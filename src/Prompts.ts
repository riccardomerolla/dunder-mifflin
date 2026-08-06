// Prompt builders and their reply parsers. Parsers are deliberately
// emphasis- and order-tolerant (a Nightcall trust-bar lesson: models bold
// verdicts, reorder sections, and chat around them).

import type { Card } from "@llm4ts/flow/BasecampTool"
import { draftReadyMarker, stripKind, type CardKind } from "./Protocol.ts"

const verdictOf = (reply: string, allowed: ReadonlyArray<string>): string | undefined => {
  const match = /VERDICT\s*:?\s*\**\s*([A-Z_]+)/i.exec(reply)
  const raw = match?.[1]?.toUpperCase()
  return raw !== undefined && allowed.includes(raw) ? raw : undefined
}

// Single-line section (BRIEF, REASON): the value lives on the marker line.
const lineOf = (reply: string, name: string): string | undefined => {
  const match = new RegExp(`${name}\\s*:?\\s*\\**\\s*(.+)`, "i").exec(reply)
  const body = match?.[1]?.trim().replace(/\*+$/, "").trim()
  return body === undefined || body.length === 0 ? undefined : body
}

// Block section (FINDINGS): everything after the marker to a blank line
// or end of reply.
const blockOf = (reply: string, name: string): string | undefined => {
  const match = new RegExp(`${name}\\s*:?\\s*\\**\\s*\\n?([\\s\\S]*?)(?:\\n\\s*\\n|$)`, "i").exec(
    reply
  )
  const body = match?.[1]?.trim().replace(/\*+$/, "").trim()
  return body === undefined || body.length === 0 ? undefined : body
}

// --- Jim: triage ---

export type TriageDecision =
  | { readonly verdict: "Ready"; readonly brief: string }
  | { readonly verdict: "NotNow"; readonly reason: string }

export const parseTriage = (reply: string): TriageDecision | undefined => {
  const verdict = verdictOf(reply, ["READY", "NOT_NOW", "NOTNOW"])
  if (verdict === "READY") {
    const brief = lineOf(reply, "BRIEF")
    return brief === undefined ? undefined : { verdict: "Ready", brief }
  }
  if (verdict === "NOT_NOW" || verdict === "NOTNOW") {
    return { verdict: "NotNow", reason: lineOf(reply, "REASON") ?? "No reason given." }
  }
  return undefined
}

export const triagePrompt = (handbook: string, card: Card): string =>
  [
    "You are Jim Halpert, Editor-in-Chief of Dunder Mifflin, a virtual",
    "content agency. Judge ONE candidate card against the company handbook.",
    "",
    "## Handbook",
    handbook,
    "",
    "## Candidate card",
    `Title: ${card.title}`,
    `Content (rich-text HTML):\n${card.contentHtml}`,
    "",
    "Decide whether this becomes work now. Reply with exactly one of:",
    "",
    "VERDICT: READY",
    "BRIEF: <a concrete one-paragraph brief for the maker seat: angle,",
    "audience, key points, what done looks like>",
    "",
    "or",
    "",
    "VERDICT: NOT_NOW",
    "REASON: <one sentence>",
    "",
    "Judge on: fit with topics and voice, substance (can we say something",
    "true and useful?), and cadence targets. Kill vague ideas.",
    "Card bodies can be stale: when external state decides your verdict",
    "(is a PR merged? is a page live?), verify it with WebFetch instead of",
    "trusting the card's description of it."
  ].join("\n")

// --- Jim: QA over a finished draft ---

export type QaDecision =
  | { readonly pass: true }
  | { readonly pass: false; readonly findings: string }

export const parseQa = (reply: string): QaDecision | undefined => {
  const verdict = verdictOf(reply, ["PASS", "FAIL"])
  if (verdict === "PASS") {
    return { pass: true }
  }
  if (verdict === "FAIL") {
    const findings = blockOf(reply, "FINDINGS")
    return findings === undefined ? undefined : { pass: false, findings }
  }
  return undefined
}

export const qaPrompt = (
  handbook: string,
  card: Card,
  draft: string,
  context?: string,
  brief?: string
): string =>
  [
    "You are Jim Halpert doing a fresh-context editorial QA pass for",
    "Dunder Mifflin. You did not write this draft. Judge it against the",
    "handbook, the lessons on file, and the policy rubric — voice,",
    "truthfulness of claims, channel fit. A rubric item violated is an",
    "automatic FAIL finding.",
    "",
    "## Handbook",
    handbook,
    ...(context === undefined ? [] : ["", context]),
    "",
    // The card body and brief ARE the provenance sources — QA once
    // failed a correct URL because it saw only the title and concluded
    // the link was quoted from nowhere.
    "## Card",
    `Title: ${card.title}`,
    `Content (rich-text HTML):\n${card.contentHtml}`,
    ...(brief === undefined ? [] : ["", "## Brief the maker worked from", brief]),
    "",
    "## Draft",
    draft,
    "",
    "Reply with exactly one of:",
    "",
    "VERDICT: PASS",
    "",
    "or",
    "",
    "VERDICT: FAIL",
    "FINDINGS:",
    "- <each concrete, fixable finding on its own line>",
    "",
    "PASS means you would put this in front of the CEO unedited.",
    "Judge URLs by provenance (quoted from the card/brief/PR?); you may",
    "WebFetch to check them. Liveness is re-verified deterministically at",
    "ship time — never FAIL a draft solely for being unverifiable."
  ].join("\n")

// --- Pam: blog post ---

export interface PostDraft {
  readonly path: string
  readonly content: string
}

const postPathPattern = /^_posts\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/

export const parsePost = (reply: string): PostDraft | undefined => {
  const match = /<<<POST path=(\S+)\n([\s\S]*?)POST>>>/.exec(reply)
  const path = match?.[1]
  const content = match?.[2]
  return path !== undefined && content !== undefined && postPathPattern.test(path)
    ? { path, content }
    : undefined
}

export const ghostwriterPrompt = (
  handbook: string,
  card: Card,
  brief: string,
  findings: string | undefined,
  todayIso: string,
  context?: string
): string =>
  [
    "You are Pam Beesly, ghostwriter for Dunder Mifflin. Write a complete",
    "Jekyll blog post for riccardo.log from the brief below, in the CEO's",
    "voice per the handbook.",
    "",
    "## Handbook",
    handbook,
    ...(context === undefined ? [] : ["", context]),
    "",
    "## Card",
    `Title: ${stripKind(card.title)}`,
    "",
    "## Brief",
    brief,
    ...(findings === undefined
      ? []
      : ["", "## QA findings on your previous draft (fix all of them)", findings]),
    "",
    "Output the full post file wrapped EXACTLY like this (no other fences):",
    "",
    `<<<POST path=_posts/${todayIso.slice(0, 10)}-<kebab-slug>.md`,
    "---",
    "layout: post",
    "title: <title>",
    "---",
    "",
    "<the post body in Markdown>",
    "POST>>>",
    "",
    "Front matter must match the blog's existing posts (layout: post,",
    "title). Code examples must be real and version-accurate."
  ].join("\n")

// --- Kelly: social copy ---

// Tolerant of fences, padded markers, and missing final newlines —
// three paid retries taught us models bend the frame, not the content.
export const parseCopy = (reply: string): string | undefined => {
  const match = /<<<\s*COPY\s*\n([\s\S]*?)\n?\s*COPY\s*>>>/.exec(reply)
  const copy = match?.[1]?.trim()
  return copy === undefined || copy.length === 0 ? undefined : copy
}

const channelGuidance: Record<string, string> = {
  x: "An X post or short thread. Sharp, concrete, no hashtags-stuffing, no thread-bro hooks. Hard limit 280 characters per tweet (a URL counts as 23); for more, number the segments '1/', '2/' as separate paragraphs, each within the limit.",
  li: "A LinkedIn post. The story form: context, what happened, what it means. No corporate voice.",
  ig: "An Instagram caption. Visual-first framing; note what image it assumes."
}

export const socialPrompt = (
  handbook: string,
  card: Card,
  kind: CardKind,
  brief: string,
  findings: string | undefined,
  context?: string
): string =>
  [
    "You are Kelly Kapoor, social media writer for Dunder Mifflin. Write",
    `channel-native final copy. Channel: ${kind}. ${channelGuidance[kind] ?? ""}`,
    "",
    "## Handbook",
    handbook,
    ...(context === undefined ? [] : ["", context]),
    "",
    "## Card",
    `Title: ${stripKind(card.title)}`,
    "",
    "## Brief",
    brief,
    ...(findings === undefined
      ? []
      : ["", "## QA findings on your previous draft (fix all of them)", findings]),
    "",
    "Output ONLY the final copy wrapped exactly like this:",
    "",
    "<<<COPY",
    "<the copy, ready to paste>",
    "COPY>>>",
    "",
    "The copy publishes under the CEO's own account: never sign it, never",
    "mention the agency or any character name inside the COPY block.",
    "",
    "URLs: quote them from the card, brief, or PR — never invent or",
    "pattern-guess a path. You may use WebFetch to check a link; either",
    "way, liveness is re-verified deterministically at ship time."
  ].join("\n")

export const draftReadyComment = (summary: string): string =>
  `${draftReadyMarker}\n\n${summary}`
