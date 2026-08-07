# Dunder Mifflin — founding design

Dunder Mifflin is a virtual AI content agency for a solopreneur: a single
long-running Effect-TS program that runs an office of LLM agents against a
Basecamp project. Basecamp is the control plane — a card table is the
content pipeline, columns are the state machine, cards are the work, card
comments are the audit trail. The deliverables are the CEO's digital
presence: blog posts, LinkedIn/X/Instagram content, opportunity research,
topic digests, and progress analysis. All LLM interaction flows through
published `@llm4ts/*` packages at a pinned release; Dunder Mifflin itself
contains no model calls, only organization.

Sibling of [Nightcall](https://github.com/riccardomerolla/nightcall) (the
dark software house): same architecture — deterministic Chief of Staff,
heartbeat, seats, budgets, ledger, signed comments — different domain,
different control plane, different deliverables.

Decision record from the founding grilling session, 2026-08-05.

## Constraints

- **Only llm4ts for intelligence.** Every model call and every Basecamp/
  GitHub operation flows through published `@llm4ts/*` at a pinned release
  (first pin: 0.8.0, the release that shipped `BasecampTool`). Library
  gaps discovered here become llm4ts specs, land there first, and arrive
  back via the next release — the Nightcall arc that produced
  `BasecampTool` itself.
- **Deterministic management.** Any decision that can be code is code.
  LLMs hold judgment seats only; the orchestrator, budgets, bookkeeping,
  column transitions, rate caps, and publishing are deterministic Effect
  programs.
- **Dark but legible.** The office runs unattended, but every action is
  attributable in Basecamp: signed card comments, invoice comments, an
  append-only JSONL ledger. Published content carries no bot signature —
  public disclosure is a CEO choice, not a default.

## The office (decisions)

| Decision       | Choice                                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship   | New sibling repo to Nightcall. Copies the proven architecture; shares no code beyond `@llm4ts/*`. A common "virtual company" kernel is extracted only if a third company appears.                                                                                                                                                |
| Control plane  | The existing **riccardo.log** Basecamp project (id 47528834, card table 9953815788), one card table = the whole pipeline, via `@llm4ts/flow/BasecampTool`. Columns are the state machine; work type rides in a title prefix (`[blog] [x] [li] [ig] [digest] [opportunity] [analysis] [suggestion]`).                             |
| State machine  | Triage (idea inbox) → Ready (briefed) → Drafting (wip) → Review (CEO gate) → Approved (publish trigger) → Done (published). Not now = parked. Set up on the board 2026-08-05: Ready 9953815795, Drafting 9953815797, Review 10169303306, Approved 10169303540 (Triage 9953815792, Not now 9953815794, Done 9953815798 built-in). |
| Publish gate   | **Approved auto-publishes.** Moving a card to Approved is the click; a deterministic publisher posts it. The CEO gates every piece in Review; Approved is authorization.                                                                                                                                                         |
| Publish path   | Direct platform APIs, phased: X first, LinkedIn second, Instagram last-or-never. Blog is already solved: posts are markdown PRs to `riccardomerolla.github.io` (Jekyll, GitHub Pages) via `GitHubTool` — create PR at Drafting-end, merge on Approved.                                                                           |
| Publisher home | Channel clients are deterministic Effect services in this repo — channel plumbing operated by the daemon, not LLM tools. Promoted to llm4ts only if a second company needs them (the BasecampTool arc).                                                                                                                          |
| Seat config    | `seats.json`, schema-decoded at startup: per seat `{ connector, model, reasoningEffort?, budgetUsdPerCard?, cadence? }` with inherited defaults, validated against the llm4ts connector-id table. Env vars carry secrets and machine-local overrides.                                                                            |
| Web access     | Research seats use CLI connectors whose harnesses have web tools (claude-cli WebSearch, gemini-cli grounding). No fetcher infrastructure in v1; a curated-feeds pipeline is a later hardening step if digest quality or cost demands it.                                                                                         |
| Metrics        | v1 Analyst reports from own telemetry (cards shipped, cadence kept, cost per piece from the ledger) plus a recurring "metrics drop" card the CEO pastes platform numbers into weekly. Platform metrics APIs arrive with each channel's publisher.                                                                                |
| Clock          | One daemon, two clocks: ~5-min heartbeat polls the board and advances cards reactively; scheduled seats fire from `cadence` fields checked against last-run timestamps in the state dir (catch-up-on-wake). Publishing targets live in COMPANY.md.                                                                               |
| Guardrails     | ~$1/card (seat-overridable), ~$10/day agency-wide via claim-throttling, JSONL ledger + invoice comment per card. Publisher hard caps: 3 X posts/day, 1 LinkedIn/day, 1 Instagram/day, 1 blog merge/day — overflow queues in Approved.                                                                                            |
| Steering       | COMPANY.md is the strategy doc: brand voice, topics of interest, niches, channel cadence targets. Injected into every seat prompt; the Editor ranks Triage against it. The CEO steers by editing it.                                                                                                                             |

## The cast

The deterministic daemon and every judgment seat is a character from The
Office (US). The CEO is David Wallace.

| Character          | Seat                        | Role                                                                                                                                                                                                                                     |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dwight Schrute** | Chief of Staff (the daemon) | Deterministic, never an LLM. Assistant to the Regional Manager: heartbeat, claims, budgets, ledger, rate caps, publishing, column transitions. Enforces the rules.                                                                       |
| **Jim Halpert**    | Editor-in-Chief             | The judgment gate. Ranks Triage against COMPANY.md, promotes to Ready with a concrete brief, parks duds to Not now, runs a fresh-context brand/QA pass on drafts before they reach Review, spawns repurpose children when a piece ships. |
| **Michael Scott**  | Opportunity Scout           | Generates business ideas: niches, digital opportunities, products. Michael Scott Paper Company energy — most ideas bad, occasionally brilliant; Jim filters. Files `[opportunity]` cards into Triage. Weekly.                            |
| **Pam Beesly**     | Ghostwriter                 | Takes `[blog]` Ready cards to a researched draft; deliverable is a Jekyll PR to the blog repo, PR link on the card entering Review.                                                                                                      |
| **Kelly Kapoor**   | Social Repurposer           | Turns shipped posts and briefs into channel-native content: `[x]` threads, `[li]` posts, `[ig]` captions. Card content is the final copy the publisher posts verbatim.                                                                   |
| **Ryan Howard**    | Trend Scout                 | Follows COMPANY.md topics, files `[digest]` cards distilling what mattered and seeds idea cards into Triage. Daily.                                                                                                                      |
| **Oscar Martinez** | Analyst                     | Weekly `[analysis]` cards: shipped volume, cadence kept vs targets, cost per piece, platform numbers from the metrics-drop card. Actual accountant energy.                                                                               |
| **Andy Bernard**   | Growth Advisor              | Audits the digital presence (profiles, bios, blog structure, SEO basics) and files `[suggestion]` cards. Cornell-grade personal branding. Weekly.                                                                                        |

Card comments are signed "— <Character>, Dunder Mifflin" (e.g. "— Dwight").

## Card lifecycle

1. Ideas enter **Triage**: from the CEO (any card you write), from Ryan's
   digests, from Michael's opportunities.
2. **Jim** ranks Triage against COMPANY.md; winners move to **Ready** with
   a brief in the card body; duds park in **Not now** with one sentence.
3. **Dwight** claims Ready cards per seat capacity and budget, moves them
   to **Drafting**, and dispatches the maker seat (Pam for `[blog]`, Kelly
   for social types).
4. The maker's deliverable lands on the card (final copy, or the blog PR
   link). **Jim** runs the fresh-context brand/QA pass: pass → **Review**,
   fail → findings comment, card stays in Drafting for one more round
   (bounded attempts, then Not now with a stuck report — ask-for-help).
5. The CEO reviews. Edits are comments; **Approved** is authorization.
6. **Dwight** publishes deterministically (X API / LinkedIn API / blog PR
   merge), respecting rate caps (overflow waits in Approved), writes the
   invoice comment, moves the card to **Done**.
7. When a `[blog]` card hits Done, **Jim** spawns `[x]`/`[li]` repurpose
   children into Ready — the content flywheel.

## Phases

1. **Phase 1 — the pipeline, no publishing.** Daemon, board protocol,
   seats.json, Jim + Pam + Kelly; blog PRs via GitHubTool (CEO merges);
   social cards end at Review (CEO copy-pastes). Trust bar: 5 pieces
   end-to-end with drafts the CEO ships unedited.
2. **Phase 2 — scouts + X publisher.** Ryan and Michael on schedules;
   X API client; Approved auto-publishes to X and auto-merges blog PRs.
3. **Phase 3 — the back office.** Oscar (telemetry + metrics-drop),
   Andy, LinkedIn publisher.
4. **Phase 4 — maybe.** Instagram (business account + Graph API),
   curated-feeds research pipeline, platform metrics APIs.

## Known llm4ts gaps (future specs)

- Basecamp message-board ops — digests/reports read better as messages
  than cards; v1 ships them as cards.
- Card due-date and position ops, if scheduling on the board is wanted.
- Basecamp attachment upload for `[ig]` image workflows (Phase 4).

## Amendment 2026-08-06: memory and policy live on Basecamp

Grilling decisions: the office's memory is the **message board** — lessons
written only by Jim on terminal events (a park at the attempt cap, CEO
rejections, repeated findings), one message per lesson, titled with the
card-kind grammar (`[x] …`, `[all] …`). Policy is **CEO-editable
todolists** named `Policy: <stage> [kind]` (e.g. `Policy: qa [all]`),
read-only to the office. Dwight injects both deterministically at
dispatch: the newest 5 kind-matched lessons and the scenario's rubric go
into maker and QA prompts; a rubric violation is an automatic FAIL
finding. The CEO curates memory by archiving messages and changes policy
by editing todolists — effective next beat, no deploy. Recall is title
filtering over `listMessages` (no search dependency). llm4ts 0.9.1
shipped the ops (`listMessages`, `createMessage --no-subscribe`,
`listTodolists`, `listTodos`); llm4ts MemoryStore (ADR 0007) is
deliberately not used — agency memory belongs on the control plane.

## Amendment 2026-08-06 (evening): the product office and the Nightcall bridge

Two seats extend the pipeline from ideas toward built software. **Jan
Levinson (Product Owner, `[product]`)** turns a chosen `[opportunity]`
idea into a PRD memo — problem, buyer, MVP scoped to what an autonomous
factory ships in ~two weeks, non-goals, one success metric, risks, and a
"Nightcall readiness" list (repo name, stack, external accounts — the
decisions a factory can't make). **Nellie Bertram (Product Designer,
`[design]`)** takes an approved PRD to a design concept: core loop,
surfaces, first-run, and the deliberate v1 cut. Both are memo seats on
the standard pipeline (brief → memo → QA → Review).

The flow: `[opportunity]` (Michael) → CEO picks one idea, files
`[product]` citing it → Jan → Review/Approve → `[design]` citing the
PRD → Nellie → Review/Approve.

**The bridge (designed, not yet built):** a `[handoff]` step where
Dwight — deterministically, via GitHubTool — creates the product's
repository, seeds it with the PRD and design memo as committed docs, and
opens the epic issues derived from the MVP scope. Nightcall picks the
repo up through `NIGHTCALL_TARGETS` and builds. Prerequisites before
implementing: CEO approval semantics for repo creation (a new public
artifact), epic-decomposition format matching Nightcall's Tech Lead
expectations (`factory:*` labels, self-contained child issues), and a
budget envelope per product. The handoff stays deterministic: judgment
ends at Approved; shipping a factory work order is a forklift job.
