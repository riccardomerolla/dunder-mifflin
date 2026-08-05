import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

// The durable ledger: one JSONL line per worked card, appended under the
// workspace. Deterministic code only — the Nightcall ledger, card-shaped.

export class LedgerEntry extends Schema.Class<LedgerEntry>("LedgerEntry")({
  at: Schema.String,
  seat: Schema.String,
  card: Schema.Int,
  outcome: Schema.Literals(["Shipped", "Advanced", "Bounced", "Failed"]),
  costUsd: Schema.Number
}) {}

export const ledgerPath = (workspaceDir: string): string => join(workspaceDir, "ledger.jsonl")

export const appendLedger = (workspaceDir: string, entry: LedgerEntry): Effect.Effect<void> =>
  Effect.ignore(
    Effect.tryPromise({
      try: async () => {
        const path = ledgerPath(workspaceDir)
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8")
      },
      catch: (error) => String(error)
    })
  )

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(LedgerEntry))

export const readLedger = (workspaceDir: string): Effect.Effect<ReadonlyArray<LedgerEntry>> =>
  Effect.tryPromise({
    try: () => readFile(ledgerPath(workspaceDir), "utf8"),
    catch: () => "missing"
  }).pipe(
    Effect.flatMap((content) =>
      Effect.forEach(
        content.split(/\r?\n/).filter((line) => line.trim().length > 0),
        (line) => decodeEntry(line).pipe(Effect.option)
      )
    ),
    Effect.map((entries) =>
      entries.flatMap((entry) => (entry._tag === "Some" ? [entry.value] : []))
    ),
    Effect.catch(() => Effect.succeed([]))
  )

// Spend recorded today (UTC), for the daily claim-throttle: the ledger is
// the durable memory that survives daemon restarts.
export const spentToday = (entries: ReadonlyArray<LedgerEntry>, nowIso: string): number => {
  const day = nowIso.slice(0, 10)
  return entries
    .filter((entry) => entry.at.slice(0, 10) === day)
    .reduce((sum, entry) => sum + entry.costUsd, 0)
}
