import { draftReadyMarker, makerSeatFor, parseKind, type MakerSeat } from "./Protocol.ts"

// The beat's decisions as a pure function over a board snapshot — the
// only part of the heartbeat with judgment-free logic worth testing.

export interface SnapshotCard {
  readonly id: number
  readonly title: string
  readonly latestOfficeMarker?: string | undefined
}

export interface BoardSnapshot {
  readonly triage: ReadonlyArray<SnapshotCard>
  readonly ready: ReadonlyArray<SnapshotCard>
  readonly drafting: ReadonlyArray<SnapshotCard>
}

export interface DecideOptions {
  readonly budgetLeftUsd: number
  readonly triagePerBeat: number
}

export type BeatAction =
  | { readonly kind: "triage"; readonly card: SnapshotCard }
  | { readonly kind: "claim"; readonly seat: MakerSeat; readonly card: SnapshotCard }
  | { readonly kind: "qa"; readonly card: SnapshotCard }

export const decide = (
  snapshot: BoardSnapshot,
  options: DecideOptions
): ReadonlyArray<BeatAction> => {
  if (options.budgetLeftUsd <= 0) {
    return []
  }
  const actions: Array<BeatAction> = []

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
    const kind = parseKind(card.title)
    const seat = kind === undefined ? undefined : makerSeatFor(kind)
    if (seat !== undefined && !claimed.has(seat)) {
      claimed.add(seat)
      actions.push({ kind: "claim", seat, card })
    }
  }

  for (const card of snapshot.drafting) {
    if (
      parseKind(card.title) !== undefined &&
      card.latestOfficeMarker !== undefined &&
      card.latestOfficeMarker.includes(draftReadyMarker)
    ) {
      actions.push({ kind: "qa", card })
    }
  }

  return actions
}
