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
      { triagePerBeat: 3 }
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
      { triagePerBeat: 3 }
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

  it("sends drafted cards to QA and bounced ones back to their maker", () => {
    const actions = decide(
      {
        ...empty,
        drafting: [
          card(20, "[x] Drafted", "DRAFT-READY\nthe copy"),
          // QA failed it: latest office comment is Jim's FINDINGS —
          // the maker redrafts, QA does not re-run on the same draft.
          card(21, "[x] Bounced", 'FINDINGS:\n- signed copy\nquoting "DRAFT-READY" is fine'),
          // Claimed but the maker produced nothing parseable yet.
          card(22, "[blog] Still working")
        ]
      },
      { triagePerBeat: 3 }
    )
    assert.deepStrictEqual(
      actions.map((action) => [action.kind, action.card.id]),
      [
        ["qa", 20],
        ["redraft", 21],
        ["redraft", 22]
      ]
    )
    const redrafts = actions.filter((action) => action.kind === "redraft")
    assert.deepStrictEqual(
      redrafts.map((action) => (action.kind === "redraft" ? action.seat : "")),
      ["social", "ghostwriter"]
    )
  })

  // Cost is telemetry, never a gate (CEO decision 2026-08-06): no
  // budget-exhausted case — the office works regardless of spend.

  it("ignores unprefixed cards everywhere", () => {
    const actions = decide(
      { triage: [card(1, "free-form CEO note")], ready: [card(2, "another")], drafting: [] },
      { triagePerBeat: 3 }
    )
    assert.deepStrictEqual(actions, [])
  })
})
