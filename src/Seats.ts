import { readFile } from "node:fs/promises"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import { makeChat } from "@llm4ts/flow/Chat"
import { CostBudget, type CostCell } from "@llm4ts/flow/CostLedger"
import type { Card } from "@llm4ts/flow/BasecampTool"
import type { FlowError } from "@llm4ts/flow/FlowError"
import type { FlowEventsShape } from "@llm4ts/flow/FlowEvents"
import { makeGitHubTool } from "@llm4ts/flow/GitHubTool"
import {
  makeFlowRunnerContext,
  nodeFlowRunnerDependencies,
  runWithBundle
} from "@llm4ts/runner/FlowRunner"
import { nodeProcessExecutor } from "@llm4ts/runner/NodeProcessExecutor"
import { ensureClone, pushPostBranch } from "./Blog.ts"
import type { BoardShape } from "./Board.ts"
import { countOfficeCommentsWith, latestOfficeCommentWith, stripSignature } from "./Board.ts"
import type { AgencyConfig } from "./Config.ts"
import { LedgerEntry, appendLedger } from "./Ledger.ts"
import {
  draftReadyComment,
  ghostwriterPrompt,
  parseCopy,
  parsePost,
  parseQa,
  parseTriage,
  qaPrompt,
  socialPrompt,
  triagePrompt
} from "./Prompts.ts"
import { draftReadyMarker, parseKind, stripKind, type MakerSeat } from "./Protocol.ts"

// Seat runners: each runs one LLM conversation inside a budgeted llm4ts
// flow-runner bundle, then writes its outcome back to the board as signed
// comments and column moves. Every run lands in the ledger.

export interface SeatDeps {
  readonly config: AgencyConfig
  readonly board: BoardShape
  readonly events: FlowEventsShape
  readonly environment: Readonly<Record<string, string | undefined>>
}

export const readHandbook = (cwd: string): Effect.Effect<string> =>
  Effect.tryPromise({
    try: () => readFile(`${cwd}/COMPANY.md`, "utf8"),
    catch: () => "missing"
  }).pipe(Effect.catch(() => Effect.succeed("")))

const totalCost = (cells: ReadonlyArray<CostCell>): number =>
  cells.reduce((sum, cell) => sum + (cell.costUsd ?? 0), 0)

interface SeatReply {
  readonly reply: string | undefined
  readonly costUsd: number
}

// One budgeted ask on a seat's configured connector. A failed run yields
// reply undefined — callers treat it as "try again next beat".
const askSeat = (
  deps: SeatDeps,
  seatKey: string,
  agent: string,
  system: string,
  prompt: string
): Effect.Effect<SeatReply> =>
  Effect.gen(function* () {
    const connector = deps.config.connectorConfigFor(seatKey)
    const seat = deps.config.seats[seatKey]
    if (connector === undefined || seat === undefined) {
      return { reply: undefined, costUsd: 0 }
    }
    const startedAtMs = yield* Clock.currentTimeMillis
    const options = {
      workDir: process.cwd(),
      workspace: process.cwd(),
      userPrompt: prompt,
      coder: connector,
      reasoning: connector,
      runId: `dm-${agent}-${startedAtMs}`,
      budget: CostBudget.make({ maximumCostUsd: seat.budgetUsdPerCard }),
      environment: deps.environment
    }
    const replyRef = yield* Ref.make<string | undefined>(undefined)
    const cellsRef = yield* Ref.make<ReadonlyArray<CostCell>>([])
    const dependencies = nodeFlowRunnerDependencies()
    yield* Effect.scoped(
      Effect.gen(function* () {
        const bundle = yield* makeFlowRunnerContext(options, dependencies)
        yield* runWithBundle(
          bundle,
          options,
          (context) =>
            Effect.gen(function* () {
              const chat = yield* makeChat(context.reasoning, {
                system,
                events: context.events,
                agent
              })
              const reply = yield* chat.ask(prompt)
              yield* Ref.set(replyRef, reply)
            }) as Effect.Effect<void, FlowError>,
          dependencies
        ).pipe(
          Effect.ensuring(
            bundle.tracker
              .awaitDrained(bundle.events)
              .pipe(
                Effect.andThen(bundle.tracker.cells),
                Effect.flatMap((cells) => Ref.set(cellsRef, cells)),
                Effect.ignore
              )
          )
        )
      })
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const cells = yield* Ref.get(cellsRef)
    return { reply: yield* Ref.get(replyRef), costUsd: totalCost(cells) }
  })

const record = (
  deps: SeatDeps,
  seat: string,
  card: Card,
  outcome: LedgerEntry["outcome"],
  costUsd: number
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    yield* appendLedger(
      deps.config.workspaceDir,
      LedgerEntry.make({
        at: new Date(nowMs).toISOString(),
        seat,
        card: card.id,
        outcome,
        costUsd
      })
    )
  })

// --- Jim: triage one card ---

export const runTriage = (deps: SeatDeps, card: Card): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const handbook = yield* readHandbook(process.cwd())
    const { reply, costUsd } = yield* askSeat(
      deps,
      "editor",
      "editor-triage",
      handbook,
      triagePrompt(handbook, card)
    )
    const decision = reply === undefined ? undefined : parseTriage(reply)
    if (decision === undefined) {
      yield* record(deps, "editor", card, "Failed", costUsd)
      return
    }
    if (decision.verdict === "Ready") {
      yield* deps.board.commentAs("Jim", card.id, `BRIEF: ${decision.brief}`)
      yield* deps.board.moveTo(card.id, "ready")
    } else {
      yield* deps.board.commentAs("Jim", card.id, `Not now: ${decision.reason}`)
      yield* deps.board.moveTo(card.id, "notNow")
    }
    yield* record(deps, "editor", card, "Advanced", costUsd)
  })

// --- Makers: Pam ([blog]) and Kelly ([x]/[li]/[ig]) ---

// Protocol comments are found by their leading marker, never by which
// character signed them (a comment may quote another's signature).
const briefFor = (deps: SeatDeps, cardId: number): Effect.Effect<string, FlowError> =>
  deps.board.comments(cardId).pipe(
    Effect.map((comments) => {
      const brief = latestOfficeCommentWith(comments, "BRIEF:")
      return brief === undefined
        ? "No brief found — use the card itself."
        : stripSignature(brief).replace(/^BRIEF:\s*/, "")
    })
  )

const findingsFor = (deps: SeatDeps, cardId: number): Effect.Effect<string | undefined, FlowError> =>
  deps.board.comments(cardId).pipe(
    Effect.map((comments) => {
      const findings = latestOfficeCommentWith(comments, "FINDINGS:")
      return findings === undefined
        ? undefined
        : stripSignature(findings).replace(/^FINDINGS:\s*/, "")
    })
  )

export const runMaker = (
  deps: SeatDeps,
  seat: MakerSeat,
  card: Card
): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const comments = yield* deps.board.comments(card.id)
    const attempts = countOfficeCommentsWith(comments, draftReadyMarker)
    if (attempts >= deps.config.maxDraftAttempts) {
      yield* deps.board.commentAs(
        seat === "ghostwriter" ? "Pam" : "Kelly",
        card.id,
        `Stuck after ${attempts} drafts — parking for the CEO. See the QA findings above.`
      )
      yield* deps.board.moveTo(card.id, "notNow")
      yield* record(deps, seat, card, "Bounced", 0)
      return
    }
    const handbook = yield* readHandbook(process.cwd())
    const brief = yield* briefFor(deps, card.id)
    const findings = yield* findingsFor(deps, card.id)
    if (seat === "ghostwriter") {
      yield* runGhostwriter(deps, card, handbook, brief, findings)
    } else {
      yield* runSocial(deps, card, handbook, brief, findings)
    }
  })

const runGhostwriter = (
  deps: SeatDeps,
  card: Card,
  handbook: string,
  brief: string,
  findings: string | undefined
): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const todayIso = new Date(nowMs).toISOString()
    const { reply, costUsd } = yield* askSeat(
      deps,
      "ghostwriter",
      "ghostwriter",
      handbook,
      ghostwriterPrompt(handbook, card, brief, findings, todayIso)
    )
    const post = reply === undefined ? undefined : parsePost(reply)
    if (post === undefined) {
      yield* deps.board.commentAs("Pam", card.id, "Draft attempt produced no parseable post; retrying next beat.")
      yield* record(deps, "ghostwriter", card, "Failed", costUsd)
      return
    }
    const cloneDir = yield* ensureClone(
      nodeProcessExecutor,
      deps.config.workspaceDir,
      deps.config.blogRepo
    )
    yield* pushPostBranch(
      nodeProcessExecutor,
      cloneDir,
      card.id,
      post.path,
      post.content,
      card.title
    )
    const gh = makeGitHubTool(nodeProcessExecutor, cloneDir, deps.events)
    const pr = yield* gh.createPr(
      stripKind(card.title),
      `Drafted by Dunder Mifflin for card ${card.id}.\n\n${card.url}`,
      "master",
      false
    )
    yield* deps.board.commentAs(
      "Pam",
      card.id,
      draftReadyComment(`Blog draft is up as a PR: ${pr.url}\n\n${post.content}`)
    )
    yield* record(deps, "ghostwriter", card, "Advanced", costUsd)
  })

const runSocial = (
  deps: SeatDeps,
  card: Card,
  handbook: string,
  brief: string,
  findings: string | undefined
): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const kind = parseKind(card.title)
    if (kind === undefined) {
      return
    }
    const { reply, costUsd } = yield* askSeat(
      deps,
      "social",
      "social",
      handbook,
      socialPrompt(handbook, card, kind, brief, findings)
    )
    const copy = reply === undefined ? undefined : parseCopy(reply)
    if (copy === undefined) {
      yield* deps.board.commentAs("Kelly", card.id, "Draft attempt produced no parseable copy; retrying next beat.")
      yield* record(deps, "social", card, "Failed", costUsd)
      return
    }
    yield* deps.board.commentAs("Kelly", card.id, draftReadyComment(copy))
    yield* record(deps, "social", card, "Advanced", costUsd)
  })

// --- Jim: fresh-context QA over a finished draft ---

export const runQa = (deps: SeatDeps, card: Card): Effect.Effect<void, FlowError> =>
  Effect.gen(function* () {
    const comments = yield* deps.board.comments(card.id)
    const draftComment = latestOfficeCommentWith(comments, draftReadyMarker)
    if (draftComment === undefined) {
      return
    }
    // Strip the marker AND the trailing agent signature: what QA judges
    // is exactly what would be published.
    const draft = stripSignature(draftComment).replace(draftReadyMarker, "").trim()
    const handbook = yield* readHandbook(process.cwd())
    const { reply, costUsd } = yield* askSeat(
      deps,
      "editor",
      "editor-qa",
      handbook,
      qaPrompt(handbook, card, draft)
    )
    const decision = reply === undefined ? undefined : parseQa(reply)
    if (decision === undefined) {
      yield* record(deps, "editor", card, "Failed", costUsd)
      return
    }
    if (decision.pass) {
      yield* deps.board.commentAs("Jim", card.id, "QA pass — over to the CEO.")
      yield* deps.board.moveTo(card.id, "review")
      yield* record(deps, "editor", card, "Advanced", costUsd)
    } else {
      yield* deps.board.commentAs("Jim", card.id, `FINDINGS:\n${decision.findings}`)
      yield* record(deps, "editor", card, "Bounced", costUsd)
    }
  })
