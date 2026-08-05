import { assert, describe, it } from "@effect/vitest"
import {
  isOfficeComment,
  makerSeatFor,
  parseKind,
  signed,
  stripKind,
  titled
} from "../src/Protocol.ts"

describe("card protocol", () => {
  it("parses work type from the title prefix", () => {
    assert.strictEqual(parseKind("[blog] Effect-TS retries deep dive"), "blog")
    assert.strictEqual(parseKind("[x] Hot take on typed errors"), "x")
    assert.strictEqual(parseKind("[opportunity] ZIO starter kits"), "opportunity")
    assert.isUndefined(parseKind("No prefix here"))
    assert.isUndefined(parseKind("[unknown] prefix"))
    assert.isUndefined(parseKind("[blog]no space"))
  })

  it("builds and strips titles symmetrically", () => {
    assert.strictEqual(titled("blog", "A post"), "[blog] A post")
    assert.strictEqual(stripKind("[blog] A post"), "A post")
    assert.strictEqual(stripKind("No prefix"), "No prefix")
  })

  it("signs comments per character and recognizes office comments", () => {
    const body = signed("Jim", "Promoted with a brief.")
    assert.include(body, "Promoted with a brief.")
    assert.include(body, "— Jim · Dunder Mifflin")
    assert.isTrue(isOfficeComment(body))
    assert.isFalse(isOfficeComment("A CEO note"))
  })

  it("routes card kinds to maker seats", () => {
    assert.strictEqual(makerSeatFor("blog"), "ghostwriter")
    assert.strictEqual(makerSeatFor("x"), "social")
    assert.strictEqual(makerSeatFor("li"), "social")
    assert.strictEqual(makerSeatFor("ig"), "social")
    assert.isUndefined(makerSeatFor("digest"))
    assert.isUndefined(makerSeatFor("analysis"))
  })
})
