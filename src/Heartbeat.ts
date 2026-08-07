import { draftReadyMarker, makerSeatFor, parseKind, type MakerSeat } from "./Protocol.ts"

// The beat's decisions as a pure function over a board snapshot — the
// only part of the heartbeat with judgment-free logic worth testing.

export interface SnapshotCard {
  readonly id: number
  readonly title: string
  readonly latestOfficeMarker?: string | undefined
  /** Blocked-by dependency whose blocker card is not Done yet. */
  readonly blocked?: boolean | undefined
}

export interface BoardSnapshot {
  readonly triage: ReadonlyArray<SnapshotCard>
  readonly ready: ReadonlyArray<SnapshotCard>
  readonly drafting: ReadonlyArray<SnapshotCard>
  readonly approved: ReadonlyArray<SnapshotCard>
}

// Cost is telemetry, never a gate (CEO decision 2026-08-06): the ledger
// records spend, the work log and beat lines report it, nothing blocks
// on it. The in-flight bound is the seats' turn cap.
export interface DecideOptions {
  readonly triagePerBeat: number
}

export type BeatAction =
  | { readonly kind: "triage"; readonly card: SnapshotCard }
  | { readonly kind: "claim"; readonly seat: MakerSeat; readonly card: SnapshotCard }
  | { readonly kind: "qa"; readonly card: SnapshotCard }
  | { readonly kind: "redraft"; readonly seat: MakerSeat; readonly card: SnapshotCard }
  | { readonly kind: "ship"; readonly card: SnapshotCard }

export const decide = (
  snapshot: BoardSnapshot,
  options: DecideOptions
): ReadonlyArray<BeatAction> => {
  const actions: Array<BeatAction> = []

  // Approved is the CEO's click: every prefixed card there ships first —
  // nothing else the office does matters more than delivering.
  for (const card of snapshot.approved) {
    if (parseKind(card.title) !== undefined) {
      actions.push({ kind: "ship", card })
    }
  }

  for (const card of snapshot.triage.slice()) {
    if (actions.filter((action) => action.kind === "triage").length >= options.triagePerBeat) {
      break
    }
    if (parseKind(card.title) !== undefined) {
      actions.push({ kind: "triage", card })
    }
  }

  // One claim per maker seat per beat: a content office ships steadily,
  // it does not sprint.
  const claimed = new Set<MakerSeat>()
  for (const card of snapshot.ready) {
    if (card.blocked === true) {
      continue
    }
    const kind = parseKind(card.title)
    const seat = kind === undefined ? undefined : makerSeatFor(kind)
    if (seat !== undefined && !claimed.has(seat)) {
      claimed.add(seat)
      actions.push({ kind: "claim", seat, card })
    }
  }

  // A Drafting card's state is the latest office comment's LEADING
  // marker: a finished draft goes to QA; a QA bounce (FINDINGS) or a
  // maker that produced nothing parseable goes back to its maker. QA
  // never re-runs on a draft it already failed.
  for (const card of snapshot.drafting) {
    const kind = parseKind(card.title)
    const seat = kind === undefined ? undefined : makerSeatFor(kind)
    if (seat === undefined) {
      continue
    }
    if (card.latestOfficeMarker?.startsWith(draftReadyMarker)) {
      actions.push({ kind: "qa", card })
    } else {
      actions.push({ kind: "redraft", seat, card })
    }
  }

  return actions
}
