import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { readFile } from "node:fs/promises"
import {
  ApiConnectorConfig,
  CliConnectorConfig,
  type ConnectorConfig
} from "@llm4ts/core/ConnectorConfig"
import { ConnectorId, cliConnectorIds, connectorIds } from "@llm4ts/core/Models"

// Agency configuration: seats.json decoded once at startup, env carrying
// only secrets and machine-local overrides (DM_SEAT_<KEY>_CONNECTOR/_MODEL).

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>("dm/ConfigError")(
  "ConfigError",
  { message: Schema.String }
) {}

export const SeatKey = Schema.Literals([
  "editor",
  "ghostwriter",
  "social",
  "trendScout",
  "opportunityScout",
  "analyst",
  "growthAdvisor"
])
export type SeatKey = typeof SeatKey.Type

export const Cadence = Schema.Literals(["daily", "weekly"])
export type Cadence = typeof Cadence.Type

export class Seat extends Schema.Class<Seat>("Seat")({
  character: Schema.String,
  connector: Schema.String,
  model: Schema.optionalKey(Schema.String),
  budgetUsdPerCard: Schema.Number,
  cadence: Schema.optionalKey(Cadence)
}) {}

const rawSeat = Schema.Struct({
  character: Schema.String,
  connector: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  budgetUsdPerCard: Schema.optionalKey(Schema.Number),
  cadence: Schema.optionalKey(Schema.NullOr(Cadence))
})

const seatsFile = Schema.Struct({
  defaults: Schema.Struct({
    connector: Schema.String,
    model: Schema.optionalKey(Schema.String),
    budgetUsdPerCard: Schema.optionalKey(Schema.Number)
  }),
  seats: Schema.Record(Schema.String, rawSeat),
  guardrails: Schema.Struct({
    dailyBudgetUsd: Schema.Number,
    publishCapsPerDay: Schema.Record(Schema.String, Schema.Int)
  }),
  board: Schema.Struct({
    project: Schema.String,
    cardTable: Schema.optionalKey(Schema.String),
    columns: Schema.Struct({
      triage: Schema.String,
      ready: Schema.String,
      drafting: Schema.String,
      review: Schema.String,
      approved: Schema.String,
      done: Schema.String,
      notNow: Schema.String
    })
  })
})

const knownConnectorValues: ReadonlyArray<string> = connectorIds.map((id) => id.value)
const cliConnectorValues: ReadonlyArray<string> = cliConnectorIds.map((id) => id.value)

export class AgencyConfig extends Schema.Class<AgencyConfig>("AgencyConfig")({
  seats: Schema.Record(Schema.String, Seat),
  guardrails: Schema.Struct({
    dailyBudgetUsd: Schema.Number,
    publishCapsPerDay: Schema.Record(Schema.String, Schema.Int)
  }),
  board: Schema.Struct({
    project: Schema.String,
    cardTable: Schema.optionalKey(Schema.String),
    columns: Schema.Struct({
      triage: Schema.String,
      ready: Schema.String,
      drafting: Schema.String,
      review: Schema.String,
      approved: Schema.String,
      done: Schema.String,
      notNow: Schema.String
    })
  }),
  heartbeatSeconds: Schema.Int,
  workspaceDir: Schema.String,
  blogRepo: Schema.String,
  claimMode: Schema.Boolean,
  triagePerBeat: Schema.Int,
  maxDraftAttempts: Schema.Int
}) {
  connectorConfigFor(seatKey: string): ConnectorConfig | undefined {
    const seat = this.seats[seatKey]
    if (seat === undefined) {
      return undefined
    }
    const connectorId = ConnectorId.make({ value: seat.connector })
    // Every seat is a chat-only judgment role — the daemon performs all
    // writes deterministically — so CLI seats run in their harness's
    // read-only mode: a prompt-injected card can never make a seat write
    // files or execute mutating commands.
    // turnLimit is the in-flight bound: the cost budget is only checked
    // after a run completes, so without it a seat can research forever
    // (a 90-minute Pam spiral proved it). llm4ts does not yet map
    // turnLimit onto claude-cli argv, so the flags passthrough carries
    // the real cap as --max-turns; turnLimit stays set for the day the
    // connector honors it.
    // "allowed-tools" WebFetch: headless permission mode auto-denies
    // every approval-gated tool, which left seats unable to check any
    // URL (the Kelly deadlock). CEO decision: all seats may fetch the
    // web. Writes stay disallowed via readOnly; Dwight still
    // fetch-verifies links at ship time regardless of what seats saw.
    return cliConnectorValues.includes(seat.connector)
      ? CliConnectorConfig.make({
          connectorId,
          readOnly: true,
          turnLimit: 40,
          flags: { "max-turns": "40", "allowed-tools": "WebFetch" },
          ...(seat.model === undefined ? {} : { model: seat.model })
        })
      : ApiConnectorConfig.make({
          connectorId,
          ...(seat.model === undefined ? {} : { model: seat.model })
        })
  }
}

const positiveOr = (raw: string | undefined, fallback: number): number => {
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const configFrom = (
  env: Readonly<Record<string, string | undefined>>,
  seatsJsonContent: string
): Effect.Effect<AgencyConfig, ConfigError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(seatsFile))(seatsJsonContent).pipe(
    Effect.mapError((error) => ConfigError.make({ message: `seats.json: ${String(error)}` })),
    Effect.flatMap((file) => {
      const seats: Record<string, Seat> = {}
      for (const [key, raw] of Object.entries(file.seats)) {
        const envKey = key.toUpperCase()
        const connector =
          env[`DM_SEAT_${envKey}_CONNECTOR`]?.trim() ||
          raw.connector ||
          file.defaults.connector
        if (!knownConnectorValues.includes(connector)) {
          return Effect.fail(
            ConfigError.make({
              message:
                `seat "${key}" names unknown connector "${connector}"; ` +
                `known: ${knownConnectorValues.join(", ")}`
            })
          )
        }
        const model =
          env[`DM_SEAT_${envKey}_MODEL`]?.trim() || raw.model || file.defaults.model
        const cadence = raw.cadence ?? undefined
        seats[key] = Seat.make({
          character: raw.character,
          connector,
          ...(model === undefined || model === null || model.length === 0 ? {} : { model }),
          budgetUsdPerCard:
            raw.budgetUsdPerCard ?? file.defaults.budgetUsdPerCard ?? 1,
          ...(cadence === undefined ? {} : { cadence })
        })
      }
      return Effect.succeed(
        AgencyConfig.make({
          seats,
          guardrails: file.guardrails,
          board: file.board,
          heartbeatSeconds: Math.floor(positiveOr(env["DM_HEARTBEAT_SECONDS"], 300)),
          workspaceDir: env["DM_WORKSPACE"]?.trim() || ".state",
          blogRepo:
            env["DM_BLOG_REPO"]?.trim() || "riccardomerolla/riccardomerolla.github.io",
          claimMode: env["DM_CLAIM"] === "1",
          triagePerBeat: Math.floor(positiveOr(env["DM_TRIAGE_PER_BEAT"], 3)),
          maxDraftAttempts: Math.floor(positiveOr(env["DM_MAX_DRAFT_ATTEMPTS"], 2))
        })
      )
    })
  )

export const loadConfig = (
  env: Readonly<Record<string, string | undefined>>,
  seatsPath: string
): Effect.Effect<AgencyConfig, ConfigError> =>
  Effect.tryPromise({
    try: () => readFile(seatsPath, "utf8"),
    catch: () => ConfigError.make({ message: `cannot read ${seatsPath}` })
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ConfigError ? error : ConfigError.make({ message: String(error) })
    ),
    Effect.flatMap((content) => configFrom(env, content))
  )
