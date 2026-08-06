import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { configFrom } from "../src/Config.ts"

const seatsJson = JSON.stringify({
  defaults: { connector: "anthropic", model: "claude-sonnet-5", budgetUsdPerCard: 1 },
  seats: {
    editor: { character: "Jim Halpert" },
    ghostwriter: {
      character: "Pam Beesly",
      connector: "claude-cli",
      model: "claude-opus-5",
      budgetUsdPerCard: 2
    },
    social: { character: "Kelly Kapoor" }
  },
  guardrails: {
    dailyBudgetUsd: 10,
    publishCapsPerDay: { x: 3, linkedin: 1, instagram: 1, blog: 1 }
  },
  board: {
    project: "47528834",
    cardTable: "9953815788",
    columns: {
      triage: "Triage",
      ready: "Ready",
      drafting: "Drafting",
      review: "Review",
      approved: "Approved",
      done: "Done",
      notNow: "Not now"
    }
  }
})

describe("agency config", () => {
  it.effect("decodes seats.json, applies defaults and env overrides", () =>
    Effect.gen(function* () {
      const config = yield* configFrom(
        { DM_SEAT_SOCIAL_CONNECTOR: "codex", DM_SEAT_SOCIAL_MODEL: "gpt-5" },
        seatsJson
      )

      assert.strictEqual(config.seats.editor?.character, "Jim Halpert")
      assert.strictEqual(config.seats.editor?.connector, "anthropic")
      assert.strictEqual(config.seats.editor?.budgetUsdPerCard, 1)
      assert.strictEqual(config.seats.ghostwriter?.connector, "claude-cli")
      assert.strictEqual(config.seats.ghostwriter?.budgetUsdPerCard, 2)
      assert.strictEqual(config.seats.social?.connector, "codex")
      assert.strictEqual(config.seats.social?.model, "gpt-5")
      assert.strictEqual(config.board.columns.approved, "Approved")
      assert.strictEqual(config.guardrails.dailyBudgetUsd, 10)
      assert.strictEqual(config.heartbeatSeconds, 300)
      assert.isFalse(config.claimMode)
    })
  )

  it.effect("rejects unknown connector ids", () =>
    Effect.gen(function* () {
      const bad = seatsJson.replace('"claude-cli"', '"clud-cli"')
      const error = yield* Effect.flip(configFrom({}, bad))
      assert.strictEqual(error._tag, "ConfigError")
      assert.include(error.message, "clud-cli")
    })
  )

  it.effect("builds Cli vs Api connector configs by connector family", () =>
    Effect.gen(function* () {
      const config = yield* configFrom({}, seatsJson)
      const editor = config.connectorConfigFor("editor")
      const ghostwriter = config.connectorConfigFor("ghostwriter")

      assert.strictEqual(editor?._tag, "ApiConnectorConfig")
      assert.strictEqual(ghostwriter?._tag, "CliConnectorConfig")
      assert.strictEqual(ghostwriter?.model, "claude-opus-5")
      // Seats are chat-only judgment roles; the daemon does all writes.
      // CLI seats must run in their harness's read-only mode so a
      // prompt-injected card can never make a seat write or execute.
      assert.isTrue(ghostwriter?._tag === "CliConnectorConfig" && ghostwriter.readOnly)
      // Budget checks fire only after a run completes; the turn limit is
      // the in-flight bound that stops a research spiral. llm4ts's
      // turnLimit field is not mapped to claude-cli argv (spec filed), so
      // the cap rides the flags passthrough as --max-turns.
      assert.isTrue(ghostwriter?._tag === "CliConnectorConfig" && ghostwriter.turnLimit === 40)
      assert.isTrue(
        ghostwriter?._tag === "CliConnectorConfig" && ghostwriter.flags["max-turns"] === "40"
      )
    })
  )
})
