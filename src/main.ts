import { resolve } from "node:path"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import type { FlowEventsShape } from "@llm4ts/flow/FlowEvents"
import { nodeProcessExecutor } from "@llm4ts/runner/NodeProcessExecutor"
import { latestOfficeComment, makeBoard, type BoardShape } from "./Board.ts"
import { loadConfig, type AgencyConfig } from "./Config.ts"
import { decide, type BoardSnapshot } from "./Heartbeat.ts"
import { readLedger, spentToday } from "./Ledger.ts"
import { runShip, shippedToday } from "./Publisher.ts"
import { parseKind } from "./Protocol.ts"
import { runMaker, runQa, runTriage, type SeatDeps } from "./Seats.ts"

// Dwight, the Chief of Staff: decode config, then run the idempotent
// heartbeat forever. Observe mode is the default — the office reports
// what it would do; DM_CLAIM=1 arms the pipeline.

const loggingEvents: FlowEventsShape = {
  publish: (event) =>
    event._tag === "Info" ? Effect.log(event.message) : Effect.logDebug(event._tag)
}

const snapshotOf = (board: BoardShape): Effect.Effect<BoardSnapshot, unknown> =>
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
    return {
      triage: triage.map((card) => ({ id: card.id, title: card.title })),
      ready: ready.map((card) => ({ id: card.id, title: card.title })),
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
    const snapshot = yield* snapshotOf(board)
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
        // The feed cap is not a cost cap: one blog merge per day keeps
        // the blog's cadence honest; overflow simply waits in Approved.
        const blogCap = config.guardrails.publishCapsPerDay["blog"] ?? 1
        if (parseKind(card.title) === "blog" && shippedToday(entries, new Date(nowMs).toISOString()) >= blogCap) {
          yield* Effect.log(`ship #${card.id} deferred: blog feed cap (${blogCap}/day) reached`)
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
    Effect.catch((error) => Effect.logWarning(`heartbeat failed: ${String(error)}`)),
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
