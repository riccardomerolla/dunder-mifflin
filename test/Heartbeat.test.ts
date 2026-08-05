import { assert, describe, it } from "@effect/vitest"
import { decide, type BoardSnapshot } from "../src/Heartbeat.ts"

const card = (id: number, title: string, officeMarker?: string) => ({
  id,
  title,
  latestOfficeMarker: officeMarker
})

const empty: BoardSnapshot = { triage: [], ready: [], drafting: [] }

describe("heartbeat decisions (pure)", () => {
  it("triages Triage cards first, bounded per beat", () => {
    const actions = decide(
      {
        ...empty,
        triage: [card(1, "[blog] A"), card(2, "[x] B"), card(3, "[li] C"), card(4, "[blog] D")]
      },
      { budgetLeftUsd: 10, triagePerBeat: 3 }
    )
    const triages = actions.filter((action) => action.kind === "triage")
    assert.strictEqual(triages.length, 3)
  })

  it("claims one Ready card per maker seat, only for maker kinds", () => {
    const actions = decide(
      {
        ...empty,
        ready: [
          card(10, "[blog] First"),
          card(11, "[blog] Second"),
          card(12, "[x] Tweet"),
          card(13, "[digest] Info only")
        ]
      },
      { budgetLeftUsd: 10, triagePerBeat: 3 }
    )
    const claims = actions.filter((action) => action.kind === "claim")
    assert.deepStrictEqual(
      claims.map((claim) => (claim.kind === "claim" ? [claim.seat, claim.card.id] : [])),
      [
        ["ghostwriter", 10],
        ["social", 12]
      ]
    )
  })

  it("sends drafted cards to QA and skips undrafted ones", () => {
    const actions = decide(
      {
        ...empty,
        drafting: [card(20, "[x] Drafted", "DRAFT-READY"), card(21, "[blog] Still working")]
      },
      { budgetLeftUsd: 10, triagePerBeat: 3 }
    )
    assert.deepStrictEqual(
      actions.map((action) => action.kind),
      ["qa"]
    )
  })

  it("does nothing when the daily budget is exhausted", () => {
    const actions = decide(
      {
        triage: [card(1, "[blog] A")],
        ready: [card(2, "[x] B")],
        drafting: [card(3, "[li] C", "DRAFT-READY")]
      },
      { budgetLeftUsd: 0, triagePerBeat: 3 }
    )
    assert.deepStrictEqual(actions, [])
  })

  it("ignores unprefixed cards everywhere", () => {
    const actions = decide(
      { triage: [card(1, "free-form CEO note")], ready: [card(2, "another")], drafting: [] },
      { budgetLeftUsd: 10, triagePerBeat: 3 }
    )
    assert.deepStrictEqual(actions, [])
  })
})
