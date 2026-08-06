import { assert, describe, it } from "@effect/vitest"
import { Message, TodoItem, Todolist } from "@llm4ts/flow/BasecampTool"
import {
  lessonsSection,
  matchesKind,
  parsePolicyName,
  rubricSection,
  parseLesson
} from "../src/Memory.ts"

const message = (id: number, title: string, html: string): Message =>
  Message.make({ id, title, contentHtml: html, createdAt: `2026-08-05T10:0${id % 10}:00Z` })

describe("agency memory and policy", () => {
  it("matches lesson titles by kind tag, with [all] applying everywhere", () => {
    assert.isTrue(matchesKind("[x] Quote real diffs", "x"))
    assert.isTrue(matchesKind("[all] Check links", "x"))
    assert.isFalse(matchesKind("[blog] Front matter rules", "x"))
    assert.isFalse(matchesKind("Untagged ramble", "x"))
  })

  it("renders the newest N matching lessons as a prompt section", () => {
    const messages = [
      message(1, "[blog] Old lesson", "<p>one</p>"),
      message(2, "[x] Quote real diffs", "<p>Never paraphrase code.</p>"),
      message(3, "[all] Check links", "<p>Resolve every URL.</p>")
    ]
    const section = lessonsSection(messages, "x", 2)
    assert.include(section, "Quote real diffs")
    assert.include(section, "Resolve every URL.")
    assert.notInclude(section, "Front matter")
    assert.strictEqual(lessonsSection([], "x", 5), undefined)
    assert.strictEqual(lessonsSection(messages, "ig", 0), undefined)
  })

  it("parses policy todolist names into stage and kind", () => {
    assert.deepStrictEqual(parsePolicyName("Policy: qa [all]"), { stage: "qa", kind: "all" })
    assert.deepStrictEqual(parsePolicyName("Policy: drafting [blog]"), {
      stage: "drafting",
      kind: "blog"
    })
    assert.isUndefined(parsePolicyName("Groceries"))
    assert.isUndefined(parsePolicyName("Policy: qa"))
  })

  it("renders matching policy rubrics with their items", () => {
    const lists: ReadonlyArray<[Todolist, ReadonlyArray<TodoItem>]> = [
      [
        Todolist.make({ id: 1, title: "Policy: qa [all]" }),
        [
          TodoItem.make({ id: 11, title: "Every URL resolves", completed: false }),
          TodoItem.make({ id: 12, title: "No agent signature", completed: false })
        ]
      ],
      [Todolist.make({ id: 2, title: "Policy: qa [blog]" }), [
        TodoItem.make({ id: 21, title: "Front matter matches", completed: false })
      ]],
      [Todolist.make({ id: 3, title: "Policy: drafting [x]" }), [
        TodoItem.make({ id: 31, title: "Thread numbered", completed: false })
      ]]
    ]
    const qaBlog = rubricSection(lists, "qa", "blog")
    assert.include(qaBlog, "Every URL resolves")
    assert.include(qaBlog, "Front matter matches")
    assert.notInclude(qaBlog, "Thread numbered")
    const qaIg = rubricSection(lists, "qa", "ig")
    assert.include(qaIg, "Every URL resolves")
    assert.notInclude(qaIg, "Front matter matches")
    assert.strictEqual(rubricSection([], "qa", "blog"), undefined)
  })

  it("parses Jim's lesson replies", () => {
    const parsed = parseLesson(
      "Reflecting...\nTITLE: [x] Quote real diffs, never paraphrase\nLESSON: Paraphrased code fails QA; quote from the tree."
    )
    assert.deepStrictEqual(parsed, {
      title: "[x] Quote real diffs, never paraphrase",
      body: "Paraphrased code fails QA; quote from the tree."
    })
    assert.isUndefined(parseLesson("no structure"))
    // A title without a leading kind tag is unusable for recall.
    assert.isUndefined(parseLesson("TITLE: untagged\nLESSON: text"))
  })
})
