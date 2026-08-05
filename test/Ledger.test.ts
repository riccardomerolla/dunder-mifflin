import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LedgerEntry, appendLedger, readLedger, spentToday } from "../src/Ledger.ts"

describe("ledger", () => {
  it.effect("appends and reads entries, summing today's spend", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "dm-ledger-")))
      const today = LedgerEntry.make({
        at: "2026-08-05T10:00:00.000Z",
        seat: "ghostwriter",
        card: 101,
        outcome: "Advanced",
        costUsd: 0.5
      })
      const yesterday = LedgerEntry.make({
        at: "2026-08-04T10:00:00.000Z",
        seat: "social",
        card: 100,
        outcome: "Shipped",
        costUsd: 2
      })
      yield* appendLedger(dir, yesterday)
      yield* appendLedger(dir, today)
      const entries = yield* readLedger(dir)

      assert.strictEqual(entries.length, 2)
      assert.strictEqual(spentToday(entries, "2026-08-05T23:00:00.000Z"), 0.5)
      assert.strictEqual(spentToday([], "2026-08-05T23:00:00.000Z"), 0)
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
    })
  )

  it.effect("reads an empty ledger from a missing file", () =>
    Effect.gen(function* () {
      const entries = yield* readLedger("/nonexistent/dm-ledger")
      assert.deepStrictEqual(entries, [])
    })
  )
})
