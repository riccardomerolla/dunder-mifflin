import { assert, describe, it } from "@effect/vitest"
import { CardComment } from "@llm4ts/flow/BasecampTool"
import { LedgerEntry } from "../src/Ledger.ts"
import { prUrlFromComments, shippedToday } from "../src/Publisher.ts"
import { signed } from "../src/Protocol.ts"

const comment = (id: number, text: string): CardComment =>
  CardComment.make({
    id,
    author: "Riccardo Merolla",
    contentHtml: `<div>${text.replace(/\n/g, "<br>")}</div>`,
    createdAt: `2026-08-06T0${id}:00:00Z`
  })

describe("Darryl, the warehouse", () => {
  it("finds the PR to merge in the latest DRAFT-READY comment", () => {
    const comments = [
      comment(1, signed("Jim", "BRIEF: write it")),
      comment(
        2,
        signed(
          "Pam",
          "DRAFT-READY\n\nBlog draft is up as a PR: https://github.com/riccardomerolla/riccardomerolla.github.io/pull/1\n\nbody"
        )
      ),
      comment(3, signed("Jim", "QA pass — over to the CEO."))
    ]
    const pr = prUrlFromComments(comments)
    assert.strictEqual(pr?.number, 1)
    assert.strictEqual(pr?.repo, "riccardomerolla.github.io")
    assert.isUndefined(prUrlFromComments([comment(1, signed("Jim", "BRIEF: no pr here"))]))
  })

  it("counts today's shipments per channel for the feed cap", () => {
    const entry = (at: string, seat: string): LedgerEntry =>
      LedgerEntry.make({ at, seat, card: 1, outcome: "Shipped", costUsd: 0 })
    const entries = [
      entry("2026-08-06T08:00:00.000Z", "publisher:blog"),
      entry("2026-08-06T09:00:00.000Z", "publisher:x"),
      entry("2026-08-05T08:00:00.000Z", "publisher:x"),
      LedgerEntry.make({
        at: "2026-08-06T09:00:00.000Z",
        seat: "editor",
        card: 2,
        outcome: "Advanced",
        costUsd: 1
      })
    ]
    assert.strictEqual(shippedToday(entries, "2026-08-06T12:00:00.000Z", "x"), 1)
    assert.strictEqual(shippedToday(entries, "2026-08-06T12:00:00.000Z", "blog"), 1)
    assert.strictEqual(shippedToday(entries, "2026-08-07T12:00:00.000Z", "x"), 0)
  })
})
