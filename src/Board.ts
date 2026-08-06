import * as Effect from "effect/Effect"
import type { ProcessExecutorShape } from "@llm4ts/core/ProcessExecutor"
import {
  BasecampProjectRef,
  makeBasecampTool,
  type BasecampToolShape,
  type Card,
  type CardComment,
  type Column,
  type Message,
  type TodoItem,
  type Todolist
} from "@llm4ts/flow/BasecampTool"
import type { FlowError } from "@llm4ts/flow/FlowError"
import type { FlowEventsShape } from "@llm4ts/flow/FlowEvents"
import type { AgencyConfig } from "./Config.ts"
import { isOfficeComment, signed } from "./Protocol.ts"

// The office's view of the Basecamp board: BasecampTool plus the agency's
// column semantics and signed-comment conventions. Deterministic only.

export type ColumnKey = keyof AgencyConfig["board"]["columns"]

export interface BoardShape {
  readonly cardsIn: (key: ColumnKey) => Effect.Effect<ReadonlyArray<Card>, FlowError>
  readonly moveTo: (cardId: number, key: ColumnKey) => Effect.Effect<void, FlowError>
  readonly commentAs: (
    character: string,
    cardId: number,
    body: string
  ) => Effect.Effect<CardComment, FlowError>
  readonly editCommentAs: (
    character: string,
    commentId: number,
    body: string
  ) => Effect.Effect<void, FlowError>
  readonly comments: (cardId: number) => Effect.Effect<ReadonlyArray<CardComment>, FlowError>
  readonly readCard: (cardId: number) => Effect.Effect<Card, FlowError>
  readonly listMessages: Effect.Effect<ReadonlyArray<Message>, FlowError>
  readonly createMessage: (title: string, body: string) => Effect.Effect<Message, FlowError>
  readonly policyLists: Effect.Effect<
    ReadonlyArray<readonly [Todolist, ReadonlyArray<TodoItem>]>,
    FlowError
  >
}

// Basecamp renders comments as rich text; recover plain text for prompt
// context and marker matching.
export const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .trim()

// Retrieval is by MARKER, never by character: a comment quoting another
// character's signature (Jim citing "— Kelly · Dunder Mifflin" in a QA
// finding) must not be misattributed. Signatures are audit trail only.
export const latestOfficeComment = (
  comments: ReadonlyArray<CardComment>
): string | undefined => {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const text = htmlToText(comments[index]?.contentHtml ?? "")
    if (isOfficeComment(text)) {
      return text
    }
  }
  return undefined
}

export const latestOfficeCommentWith = (
  comments: ReadonlyArray<CardComment>,
  marker: string
): string | undefined => {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const text = htmlToText(comments[index]?.contentHtml ?? "")
    if (isOfficeComment(text) && text.startsWith(marker)) {
      return text
    }
  }
  return undefined
}

// The signature commentAs appends must never leak into published copy.
export const stripSignature = (text: string): string =>
  text.replace(/\n*— [^\n]*· Dunder Mifflin\s*$/, "").trim()

// Draft attempts since the most recent brief: a CEO re-queue through
// Triage yields a fresh BRIEF from Jim, which resets the cap — without
// this, a parked card would re-park instantly on revival.
export const draftAttemptsSinceBrief = (comments: ReadonlyArray<CardComment>): number => {
  let attempts = 0
  for (const comment of comments) {
    const text = htmlToText(comment.contentHtml)
    if (!isOfficeComment(text)) {
      continue
    }
    if (text.startsWith("BRIEF:")) {
      attempts = 0
    } else if (text.startsWith("DRAFT-READY") || text.startsWith("DRAFT-FAILED")) {
      attempts += 1
    }
  }
  return attempts
}

export const makeBoard = (
  config: AgencyConfig,
  process: ProcessExecutorShape,
  workDir: string,
  events: FlowEventsShape
): Effect.Effect<BoardShape> =>
  Effect.map(
    makeBasecampTool(
      process,
      workDir,
      events,
      BasecampProjectRef.make({
        project: config.board.project,
        ...(config.board.cardTable === undefined ? {} : { cardTable: config.board.cardTable })
      })
    ),
    (basecamp: BasecampToolShape): BoardShape => {
      const column = (key: ColumnKey): Effect.Effect<Column, FlowError> =>
        basecamp.resolveColumn(config.board.columns[key])
      return {
        cardsIn: (key) => column(key).pipe(Effect.flatMap(basecamp.listCards)),
        moveTo: (cardId, key) =>
          column(key).pipe(Effect.flatMap((target) => basecamp.moveCard(cardId, target))),
        commentAs: (character, cardId, body) =>
          basecamp.writeCardComment(cardId, signed(character, body)),
        editCommentAs: (character, commentId, body) =>
          basecamp.editCardComment(commentId, signed(character, body)),
        comments: basecamp.readCardComments,
        readCard: basecamp.readCard,
        listMessages: basecamp.listMessages,
        createMessage: basecamp.createMessage,
        policyLists: basecamp.listTodolists.pipe(
          Effect.flatMap((lists) =>
            Effect.forEach(lists, (list) =>
              basecamp.listTodos(list.id).pipe(Effect.map((todos) => [list, todos] as const))
            )
          )
        )
      }
    }
  )
