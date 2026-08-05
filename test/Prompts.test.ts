import { assert, describe, it } from "@effect/vitest"
import { parseCopy, parsePost, parseQa, parseTriage } from "../src/Prompts.ts"

describe("reply parsers (emphasis- and order-tolerant)", () => {
  it("parses triage verdicts", () => {
    assert.deepStrictEqual(
      parseTriage("Thinking...\n**VERDICT: READY**\nBRIEF: Write about typed retries.\nMore."),
      { verdict: "Ready", brief: "Write about typed retries." }
    )
    assert.deepStrictEqual(parseTriage("VERDICT: NOT_NOW\nREASON: Off-topic."), {
      verdict: "NotNow",
      reason: "Off-topic."
    })
    assert.isUndefined(parseTriage("I could not decide."))
    // A READY without a brief is unusable — treated as unparseable.
    assert.isUndefined(parseTriage("VERDICT: READY"))
  })

  it("parses QA verdicts with findings", () => {
    assert.deepStrictEqual(parseQa("VERDICT: PASS"), { pass: true })
    const fail = parseQa("Notes\nVERDICT: FAIL\nFINDINGS:\n- claim unchecked\n- wrong tone")
    assert.deepStrictEqual(fail, { pass: false, findings: "- claim unchecked\n- wrong tone" })
    assert.isUndefined(parseQa("VERDICT: MAYBE"))
    // FAIL without findings is unusable for the maker's retry.
    assert.isUndefined(parseQa("VERDICT: FAIL"))
  })

  it("parses ghostwriter post blocks with a validated path", () => {
    const reply = [
      "Here is the post.",
      "<<<POST path=_posts/2026-08-05-typed-retries.md",
      "---",
      "layout: post",
      "title: Typed retries",
      "---",
      "Body.",
      "POST>>>"
    ].join("\n")
    const post = parsePost(reply)
    assert.strictEqual(post?.path, "_posts/2026-08-05-typed-retries.md")
    assert.include(post?.content, "layout: post")
    assert.isTrue(post?.content.endsWith("Body.\n"))
    assert.isUndefined(parsePost("no block"))
    assert.isUndefined(
      parsePost("<<<POST path=../evil.md\nX\nPOST>>>"),
      "path outside _posts is rejected"
    )
  })

  it("parses social copy blocks", () => {
    assert.strictEqual(parseCopy("Intro\n<<<COPY\nShip small.\nCOPY>>>\nOutro"), "Ship small.")
    assert.isUndefined(parseCopy("nothing"))
  })
})
