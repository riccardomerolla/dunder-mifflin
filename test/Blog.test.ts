import { assert, describe, it } from "@effect/vitest"
import { branchFor, cloneCommands, publishCommands, slugOf } from "../src/Blog.ts"

describe("blog git plumbing (pure command builders)", () => {
  it("derives slugs and branch names from card ids and paths", () => {
    assert.strictEqual(slugOf("_posts/2026-08-05-typed-retries.md"), "typed-retries")
    assert.strictEqual(branchFor(101, "_posts/2026-08-05-typed-retries.md"), "dm/card-101-typed-retries")
  })

  it("builds clone-or-fetch command sequences", () => {
    const fresh = cloneCommands("riccardomerolla/riccardomerolla.github.io", "/ws/blog", false)
    assert.deepStrictEqual(fresh[0], [
      "gh",
      "repo",
      "clone",
      "riccardomerolla/riccardomerolla.github.io",
      "/ws/blog"
    ])
    const existing = cloneCommands("riccardomerolla/riccardomerolla.github.io", "/ws/blog", true)
    assert.deepStrictEqual(existing, [["git", "fetch", "origin", "master"]])
  })

  it("builds the branch/commit/push sequence with no interpolated content", () => {
    const commands = publishCommands("dm/card-101-typed-retries", "_posts/2026-08-05-typed-retries.md", "[blog] Typed retries")
    assert.deepStrictEqual(commands, [
      ["git", "checkout", "-B", "dm/card-101-typed-retries", "origin/master"],
      ["git", "add", "_posts/2026-08-05-typed-retries.md"],
      ["git", "commit", "-m", "[blog] Typed retries"],
      ["git", "push", "-u", "origin", "dm/card-101-typed-retries", "--force-with-lease"]
    ])
  })
})
