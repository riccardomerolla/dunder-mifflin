import { assert, describe, it } from "@effect/vitest"
import { CardComment } from "@llm4ts/flow/BasecampTool"
import {
  draftAttemptsSinceBrief,
  latestOfficeComment,
  latestOfficeCommentWith,
  stripSignature
} from "../src/Board.ts"
import { signed } from "../src/Protocol.ts"

const comment = (id: number, text: string): CardComment =>
  CardComment.make({
    id,
    author: "Riccardo Merolla",
    contentHtml: `<div>${text.replace(/\n/g, "<br>")}</div>`,
    createdAt: `2026-08-05T10:0${id}:00Z`
  })

describe("board comment conventions", () => {
  it("finds the latest office comment regardless of which character wrote it", () => {
    const comments = [
      comment(1, "CEO note, unsigned"),
      comment(2, signed("Kelly", "DRAFT-READY\nthe copy")),
      comment(3, signed("Jim", 'FINDINGS:\n- Kelly signed it "— Kelly · Dunder Mifflin"'))
    ]
    assert.include(latestOfficeComment(comments), "FINDINGS:")
    // Retrieval by marker, not by character: Jim quoting Kelly's
    // signature must not misattribute his comment to Kelly.
    assert.include(latestOfficeCommentWith(comments, "DRAFT-READY"), "the copy")
    assert.isUndefined(latestOfficeCommentWith(comments, "BRIEF:"))
    assert.isUndefined(latestOfficeComment([comment(1, "CEO note")]))
  })

  it("counts draft attempts since the latest brief, so a re-triage resets the cap", () => {
    const history = [
      comment(1, signed("Jim", "BRIEF: first angle")),
      comment(2, signed("Kelly", "DRAFT-READY\nv1")),
      comment(3, signed("Jim", "FINDINGS:\n- bad")),
      comment(4, signed("Kelly", "DRAFT-READY\nv2")),
      comment(5, signed("Kelly", "Stuck after 2 drafts — parking for the CEO."))
    ]
    // history ends with the park comment, which itself resets the count.
    assert.strictEqual(draftAttemptsSinceBrief(history), 0)
    assert.strictEqual(draftAttemptsSinceBrief(history.slice(0, 4)), 2)
    // Unparseable attempts burn money too: DRAFT-FAILED counts, or a
    // maker retries forever (Kelly, three paid loops, 2026-08-06).
    assert.strictEqual(
      draftAttemptsSinceBrief([
        comment(1, signed("Jim", "BRIEF: angle")),
        comment(2, signed("Kelly", "DRAFT-FAILED\nno parseable copy")),
        comment(3, signed("Kelly", "DRAFT-READY\nv1"))
      ]),
      2
    )
    // The CEO re-queues through Triage: Jim's new brief resets the count.
    const revived = [...history, comment(6, signed("Jim", "BRIEF: new angle, fix the link"))]
    assert.strictEqual(draftAttemptsSinceBrief(revived), 0)
    // A park also resets: anything after it means a human deliberately
    // revived the card — dragging it straight to Ready must not insta-park.
    const parked = [
      ...history.slice(0, 4),
      comment(5, signed("Kelly", "Stuck after 2 drafts — parking for the CEO.")),
      comment(6, signed("Kelly", "DRAFT-READY\nv3"))
    ]
    assert.strictEqual(draftAttemptsSinceBrief(parked), 1)
    // The cap guards a single unattended maker↔QA cycle. ANY other
    // office comment — a QA pass, a Darryl ship-bounce — ends the cycle
    // and resets the count: a CEO sending a card back always gets fresh
    // attempts (live incident: post-QA-pass revival insta-parked).
    const afterQaPass = [
      ...history.slice(0, 4),
      comment(5, signed("Jim", "QA pass — over to the CEO.")),
      comment(6, signed("Dwight", "🚚 Darryl: a tweet segment exceeds 280 characters"))
    ]
    assert.strictEqual(draftAttemptsSinceBrief(afterQaPass), 0)
    // The ambient WORK-LOG comment neither counts nor resets.
    const withWorkLog = [
      comment(1, signed("Jim", "BRIEF: angle")),
      comment(2, signed("Dwight", "WORK-LOG\n\n• line")),
      comment(3, signed("Kelly", "DRAFT-READY\nv1"))
    ]
    assert.strictEqual(draftAttemptsSinceBrief(withWorkLog), 1)
    assert.strictEqual(draftAttemptsSinceBrief([]), 0)
  })

  it("strips the trailing signature so published copy never carries it", () => {
    const text = signed("Kelly", "Ship small.\nShip often.")
    assert.strictEqual(stripSignature(text), "Ship small.\nShip often.")
    assert.strictEqual(stripSignature("No signature here"), "No signature here")
  })
})
