import { assert, describe, it } from "@effect/vitest"
import { durationLabel, renderWorkLog, workLogLines, workLogMarker } from "../src/WorkLog.ts"
import { signed } from "../src/Protocol.ts"

describe("card work log", () => {
  it("renders frozen lines and an optional live tail under the marker", () => {
    const body = renderWorkLog(
      ["🔨 Pam draft #1 · 15m · draft ready · $0.47"],
      "🔎 Jim QA since 09:49 · 3 tool calls · ● Read CHANGELOG.md"
    )
    assert.isTrue(body.startsWith(workLogMarker))
    assert.include(body, "• 🔨 Pam draft #1")
    assert.include(body, "▶ currently: 🔎 Jim QA since 09:49")
    const frozen = renderWorkLog(["🔨 Pam draft #1 · 15m · draft ready · $0.47"])
    assert.notInclude(frozen, "▶")
  })

  it("recovers frozen lines from a signed comment, dropping the live tail", () => {
    const text = signed(
      "Dwight",
      renderWorkLog(
        ["🔨 Pam draft #1 · 15m · no parseable post · $0.30", "🔎 Jim QA #1 · 2m · FAIL · $0.49"],
        "🔨 Kelly redraft since 10:02"
      )
    )
    assert.deepStrictEqual(workLogLines(text), [
      "🔨 Pam draft #1 · 15m · no parseable post · $0.30",
      "🔎 Jim QA #1 · 2m · FAIL · $0.49"
    ])
    assert.deepStrictEqual(workLogLines("not a work log"), [])
  })

  it("formats durations compactly", () => {
    assert.strictEqual(durationLabel(42_000), "42s")
    assert.strictEqual(durationLabel(65_000), "1m5s")
    assert.strictEqual(durationLabel(15 * 60_000), "15m")
  })
})
