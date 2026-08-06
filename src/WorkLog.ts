// The card's living work log (grilling 2026-08-06): ONE comment per
// card, created at first claim and found statelessly by its leading
// marker. Each seat run freezes a "• " line; the "▶ currently:" tail is
// the live run, edited throttled while agents work. Deterministic
// rendering only — the live updater lives in Seats.

export const workLogMarker = "WORK-LOG"

export const renderWorkLog = (
  lines: ReadonlyArray<string>,
  current?: string
): string =>
  [
    workLogMarker,
    "",
    ...lines.map((line) => `• ${line}`),
    ...(current === undefined ? [] : [`▶ currently: ${current}`])
  ].join("\n")

// Frozen lines from an existing (signed, html-to-texted) work-log
// comment. The live tail and the signature are transient — dropped.
export const workLogLines = (text: string): ReadonlyArray<string> => {
  if (!text.trimStart().startsWith(workLogMarker)) {
    return []
  }
  return text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("• "))
    .map((line) => line.trimStart().slice(2).trim())
}

export const durationLabel = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`
}
