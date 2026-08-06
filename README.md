# Dunder Mifflin 📄

A virtual AI content agency for a solopreneur, run as an office of LLM
agents against a Basecamp card table. Sibling of
[Nightcall](https://github.com/riccardomerolla/nightcall): same
architecture (deterministic Chief of Staff, heartbeat, seats, budgets,
ledger), different shift — Nightcall writes software in the dark, Dunder
Mifflin publishes the CEO's digital presence.

- **[DESIGN.md](DESIGN.md)** — founding decision record: constraints,
  board protocol, the cast, card lifecycle, phases.
- **[COMPANY.md](COMPANY.md)** — the strategy doc every seat reads; the
  CEO steers by editing it.
- **[seats.json](seats.json)** — per-seat llm4ts connector/model,
  cadences, guardrails, board bindings.

Control plane: Basecamp project **riccardo.log** (card table
Triage → Ready → Drafting → Review → Approved → Done, Not now parked).
All intelligence via published `@llm4ts/*` at a pinned release
(currently 0.8.0, the release that shipped `BasecampTool`).

## Status

Phase 1 implemented (pinned llm4ts 0.8.1): Dwight's heartbeat with the
daily-budget throttle and ledger, Jim's triage (Triage → Ready with a
brief, or Not now) and fresh-context QA gate (Drafting → Review), Pam's
blog drafts as PR branches on the blog repo, Kelly's channel-native
social copy as signed DRAFT-READY comments. Observe mode is the default —
the daemon logs what it would do; `DM_CLAIM=1` arms it. No publishing:
cards end at Review for the CEO (Phase 1 trust bar: 5 pieces shipped
unedited).

```bash
pnpm install
pnpm typecheck && pnpm test
node --experimental-strip-types src/main.ts        # observe mode
DM_CLAIM=1 node --experimental-strip-types src/main.ts  # armed
```

**X publishing**: Darryl posts approved `[x]` cards (single tweets or
numbered threads) via the X API v2 with OAuth 1.0a user context. Copy
`.env.example` to `.env` (gitignored, loaded by the daemon at startup)
and fill the four `DM_X_*` values from a Read+Write app at
developer.x.com, then restart the daemon. Without them, approved X
cards wait in Approved with an honest note.

Every seat runs on the `claude` CLI connector, so there is no API key in
the environment at all: seats use the CLI's own subscription auth, the
blog PR path uses `gh` auth, and the board uses `basecamp` CLI auth. No
secrets ever live in this repo or its config. (Any seat can still be
swapped to an API or other CLI connector in seats.json or via
`DM_SEAT_<NAME>_CONNECTOR` — note codex does not yet report cost, which
weakens that seat's budget enforcement.)
