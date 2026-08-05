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

Implementation status: pre-phase-1 — founding docs only.
