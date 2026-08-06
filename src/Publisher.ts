import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type { Card, CardComment } from "@llm4ts/flow/BasecampTool"
import type { FlowError } from "@llm4ts/flow/FlowError"
import { makeGitHubTool, parsePullRequestUrl, type PullRequest } from "@llm4ts/flow/GitHubTool"
import { nodeProcessExecutor } from "@llm4ts/runner/NodeProcessExecutor"
import { htmlToText, latestOfficeCommentWith, stripSignature } from "./Board.ts"
import { LedgerEntry, appendLedger, type LedgerEntry as Entry } from "./Ledger.ts"
import { draftReadyMarker, parseKind } from "./Protocol.ts"
import { credentialsFromEnv, postThread, splitTweets } from "./XClient.ts"
import type { SeatDeps } from "./Seats.ts"
import { renderWorkLog, workLogLines, workLogMarker } from "./WorkLog.ts"

// Darryl Philbin, the warehouse: when the CEO moves a card to Approved,
// Darryl ships it. Deterministic, never an LLM — shipping is a forklift
// job. Blog cards merge their PR (squash, delete branch) and move to
// Done; channels without a publisher yet get one honest note and wait.

export const prUrlFromComments = (
  comments: ReadonlyArray<CardComment>
): PullRequest | undefined => {
  const draft = latestOfficeCommentWith(comments, draftReadyMarker)
  const url = draft === undefined ? undefined : /https?:\/\/\S+\/pull\/\d+/.exec(draft)?.[0]
  return url === undefined ? undefined : parsePullRequestUrl(url)
}

// Shipments recorded today (UTC) per channel — the per-day feed cap
// reads the same durable ledger as everything else. Entries are tagged
// seat "publisher:<channel>".
export const shippedToday = (
  entries: ReadonlyArray<Entry>,
  nowIso: string,
  channel: string
): number => {
  const day = nowIso.slice(0, 10)
  return entries.filter(
    (entry) =>
      entry.seat === `publisher:${channel}` &&
      entry.outcome === "Shipped" &&
      entry.at.slice(0, 10) === day
  ).length
}

export const channelOf = (kind: string): string => {
  switch (kind) {
    case "blog":
      return "blog"
    case "x":
      return "x"
    case "li":
      return "linkedin"
    case "ig":
      return "instagram"
    default:
      return kind
  }
}

const advisoryNote = "🚚 Darryl: no publisher for this channel yet"

const freezeShipLine = (
  deps: SeatDeps,
  comments: ReadonlyArray<CardComment>,
  line: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let index = comments.length - 1; index >= 0; index -= 1) {
      const comment = comments[index]
      const text = htmlToText(comment?.contentHtml ?? "")
      if (comment !== undefined && text.trimStart().startsWith(workLogMarker)) {
        yield* deps.board
          .editCommentAs("Dwight", comment.id, renderWorkLog([...workLogLines(text), line]))
          .pipe(Effect.ignore)
        return
      }
    }
  })

const recordShipment = (
  deps: SeatDeps,
  cardId: number,
  channel: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    yield* appendLedger(
      deps.config.workspaceDir,
      LedgerEntry.make({
        at: new Date(nowMs).toISOString(),
        seat: `publisher:${channel}`,
        card: cardId,
        outcome: "Shipped",
        costUsd: 0
      })
    )
  })

// The X path: final copy is the latest DRAFT-READY comment, marker and
// signature stripped — exactly what Jim QA'd. Missing credentials get
// one honest note; the card waits in Approved.
const shipTweet = (
  deps: SeatDeps,
  card: Card,
  comments: ReadonlyArray<CardComment>
): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const credentials = credentialsFromEnv(deps.environment)
    if (credentials === undefined) {
      const note = "🚚 Darryl: X credentials missing"
      const already = comments.some((comment) => htmlToText(comment.contentHtml).includes(note))
      if (!already) {
        yield* deps.board.commentAs(
          "Dwight",
          card.id,
          `${note} — set DM_X_API_KEY / DM_X_API_SECRET / DM_X_ACCESS_TOKEN / DM_X_ACCESS_SECRET (a Read+Write app at developer.x.com) and restart the daemon; the card waits here.`
        )
      }
      return
    }
    const draft = latestOfficeCommentWith(comments, draftReadyMarker)
    if (draft === undefined) {
      yield* deps.board.commentAs(
        "Dwight",
        card.id,
        "🚚 Darryl found no DRAFT-READY copy on this card — cannot post."
      )
      return
    }
    const copy = stripSignature(draft).replace(draftReadyMarker, "").trim()
    const tweets = splitTweets(copy)
    if (tweets === undefined) {
      yield* deps.board.commentAs(
        "Dwight",
        card.id,
        "🚚 Darryl: a tweet segment exceeds 280 characters — send it back to Drafting for a trim; I don't cut anyone's words."
      )
      return
    }
    const firstId = yield* postThread(credentials, tweets)
    const url = `https://x.com/i/web/status/${firstId}`
    yield* deps.board.moveTo(card.id, "done")
    yield* freezeShipLine(
      deps,
      comments,
      `🚚 Darryl shipped · ${tweets.length > 1 ? `${tweets.length}-tweet thread` : "tweet"} posted · ${url}`
    )
    yield* recordShipment(deps, card.id, "x")
  })

export const runShip = (deps: SeatDeps, card: Card): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const kind = parseKind(card.title)
    if (kind === undefined) {
      return
    }
    const comments = yield* deps.board.comments(card.id)
    if (kind === "x") {
      yield* shipTweet(deps, card, comments)
      return
    }
    if (kind !== "blog") {
      // One honest note per card; the card waits in Approved for the
      // channel's publisher (Phase 2) or a manual paste.
      const already = comments.some((comment) =>
        htmlToText(comment.contentHtml).includes(advisoryNote)
      )
      if (!already) {
        yield* deps.board.commentAs(
          "Dwight",
          card.id,
          `${advisoryNote} — the [${kind}] copy above is final; paste it manually and move the card to Done, or wait for the channel integration.`
        )
      }
      return
    }
    const pr = prUrlFromComments(comments)
    if (pr === undefined) {
      yield* deps.board.commentAs(
        "Dwight",
        card.id,
        "🚚 Darryl found no PR link in the DRAFT-READY comment — cannot ship this blog card."
      )
      return
    }
    const gh = makeGitHubTool(nodeProcessExecutor, process.cwd(), deps.events)
    yield* gh.mergePr(pr, "squash", true)
    yield* deps.board.moveTo(card.id, "done")
    yield* freezeShipLine(
      deps,
      comments,
      `🚚 Darryl shipped · merged ${pr.shortRef} · live on the blog`
    )
    yield* recordShipment(deps, card.id, "blog")
  })
