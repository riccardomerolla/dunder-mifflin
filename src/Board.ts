import * as Effect from "effect/Effect"
import type { ProcessExecutorShape } from "@llm4ts/core/ProcessExecutor"
import {
  BasecampProjectRef,
  makeBasecampTool,
  type BasecampToolShape,
  type Card,
  type CardComment,
  type Column
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
  ) => Effect.Effect<void, FlowError>
  readonly comments: (cardId: number) => Effect.Effect<ReadonlyArray<CardComment>, FlowError>
  readonly readCard: (cardId: number) => Effect.Effect<Card, FlowError>
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

export const latestOfficeCommentBy = (
  comments: ReadonlyArray<CardComment>,
  character: string
): string | undefined => {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const text = htmlToText(comments[index]?.contentHtml ?? "")
    if (isOfficeComment(text) && text.includes(`— ${character}`)) {
      return text
    }
  }
  return undefined
}

export const countOfficeCommentsWith = (
  comments: ReadonlyArray<CardComment>,
  marker: string
): number =>
  comments.filter((comment) => {
    const text = htmlToText(comment.contentHtml)
    return isOfficeComment(text) && text.includes(marker)
  }).length

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
        comments: basecamp.readCardComments,
        readCard: basecamp.readCard
      }
    }
  )
