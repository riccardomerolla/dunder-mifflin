import { resolve } from "node:path"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import type { FlowEventsShape } from "@llm4ts/flow/FlowEvents"
import { nodeProcessExecutor } from "@llm4ts/runner/NodeProcessExecutor"
import { htmlToText, latestOfficeComment, makeBoard, type BoardShape } from "./Board.ts"
import { describeFlowError } from "@llm4ts/flow/FlowError"
import { loadConfig, type AgencyConfig } from "./Config.ts"
import { decide, type BoardSnapshot } from "./Heartbeat.ts"
import { readLedger, spentToday } from "./Ledger.ts"
import { channelOf, runShip, shippedToday } from "./Publisher.ts"
import { parseBlocker, parseKind } from "./Protocol.ts"
import { runMaker, runQa, runTriage, type SeatDeps } from "./Seats.ts"

// Dwight, the Chief of Staff: decode config, then run the idempotent
// heartbeat forever. Observe mode is the default — the office reports
// what it would do; DM_CLAIM=1 arms the pipeline.

const loggingEvents: FlowEventsShape = {
  publish: (event) =>
    event._tag === "Info" ? Effect.log(event.message) : Effect.logDebug(event._tag)
}

const snapshotOf = (
  board: BoardShape,
  doneColumn: string
): Effect.Effect<BoardSnapshot, unknown> =>
  Effect.gen(function* () {
    const [triage, ready, drafting, approved] = yield* Effect.all([
      board.cardsIn("triage"),
      board.cardsIn("ready"),
      board.cardsIn("drafting"),
      board.cardsIn("approved")
    ])
    // Only Drafting cards need their latest office marker (for QA gating);
    // fetching comments per card is fine at content-office volume.
    const draftingWithMarkers = yield* Effect.forEach(drafting, (card) =>
      board.comments(card.id).pipe(
        Effect.map((comments) => ({
          id: card.id,
          title: card.title,
          latestOfficeMarker: latestOfficeComment(comments)
        }))
      )
    )
    // A Ready card naming a Blocked-by dependency stays unclaimed until
    // its blocker card reaches Done; an unreadable blocker counts as
    // blocking (fail closed).
    const readyWithBlocks = yield* Effect.forEach(ready, (card) =>
      Effect.gen(function* () {
        const blockerId = parseBlocker(htmlToText(card.contentHtml))
        if (blockerId === undefined) {
          return { id: card.id, title: card.title }
        }
        const blockerColumn: string | undefined = yield* board.readCard(blockerId).pipe(
          Effect.map((blocker): string | undefined => blocker.column.title),
          Effect.catch(() => Effect.succeed(undefined))
        )
        return {
          id: card.id,
          title: card.title,
          blocked: blockerColumn !== doneColumn
        }
      })
    )
    return {
      triage: triage.map((card) => ({ id: card.id, title: card.title })),
      ready: readyWithBlocks,
      drafting: draftingWithMarkers,
      approved: approved.map((card) => ({ id: card.id, title: card.title }))
    }
  })

const beat = (
  config: AgencyConfig,
  board: BoardShape,
  deps: SeatDeps
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const entries = yield* readLedger(config.workspaceDir)
    const spent = spentToday(entries, new Date(nowMs).toISOString())
    const snapshot = yield* snapshotOf(board, config.board.columns.done)
    const actions = decide(snapshot, { triagePerBeat: config.triagePerBeat })
    if (actions.length === 0) {
      yield* Effect.log(`beat: quiet board ($${spent.toFixed(2)} spent today)`)
      return
    }
    if (!config.claimMode) {
      yield* Effect.log(
        `beat (observe): would ${actions
          .map((action) =>
            action.kind === "claim"
              ? `claim #${action.card.id} for ${action.seat}`
              : `${action.kind} #${action.card.id}`
          )
          .join(", ")} — set DM_CLAIM=1 to arm`
      )
      return
    }
    yield* Effect.log(
      `beat: ${actions
        .map((action) =>
          action.kind === "claim" || action.kind === "redraft"
            ? `${action.kind} #${action.card.id} (${action.seat})`
            : `${action.kind} #${action.card.id}`
        )
        .join(", ")} ($${spent.toFixed(2)} spent today)`
    )
    for (const action of actions) {
      const card = yield* board.readCard(action.card.id)
      if (action.kind === "ship") {
        // The feed cap is not a cost cap: per-channel posts/day keep the
        // feeds honest; overflow simply waits in Approved.
        const channel = channelOf(parseKind(card.title) ?? "")
        const cap = config.guardrails.publishCapsPerDay[channel] ?? 1
        if (shippedToday(entries, new Date(nowMs).toISOString(), channel) >= cap) {
          yield* Effect.log(`ship #${card.id} deferred: ${channel} feed cap (${cap}/day) reached`)
        } else {
          yield* runShip(deps, card)
        }
      } else if (action.kind === "triage") {
        yield* runTriage(deps, card)
      } else if (action.kind === "claim") {
        yield* board.moveTo(card.id, "drafting")
        yield* runMaker(deps, action.seat, card)
      } else if (action.kind === "redraft") {
        yield* runMaker(deps, action.seat, card)
      } else {
        yield* runQa(deps, card)
      }
    }
  })

const program = Effect.gen(function* () {
  // Secrets (X credentials) and machine-local knobs live in .env —
  // gitignored, loaded natively, absent in CI. Missing file is fine.
  try {
    process.loadEnvFile(resolve(".env"))
  } catch {
    // no .env — env comes from the shell alone
  }
  const config = yield* loadConfig(process.env, resolve("seats.json"))
  const board = yield* makeBoard(config, nodeProcessExecutor, process.cwd(), loggingEvents)
  const deps: SeatDeps = {
    config,
    board,
    events: loggingEvents,
    environment: process.env
  }
  yield* Effect.log(
    `Dunder Mifflin up: board ${config.board.project}, heartbeat ${config.heartbeatSeconds}s, ` +
      `cost tracked, no caps, ${config.claimMode ? "CLAIM" : "observe"} mode`
  )
  yield* beat(config, board, deps).pipe(
    // A failed beat (basecamp CLI missing, network down) is reported and
    // the daemon stays up: the next beat re-derives everything from the
    // board.
    Effect.catch((error) => Effect.logWarning(`heartbeat failed: ${describeFlowError(error)}`)),
    Effect.asVoid,
    Effect.andThen(Effect.sleep(`${config.heartbeatSeconds} seconds`)),
    Effect.repeat(Schedule.forever)
  )
})

program.pipe(
  Effect.catchTag("ConfigError", (error) =>
    Effect.sync(() => {
      console.error(`dunder-mifflin: ${error.message}`)
      process.exitCode = 1
    })
  ),
  Effect.runPromise
)
