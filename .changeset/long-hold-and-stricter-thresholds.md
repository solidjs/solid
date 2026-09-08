---
"@solidjs/signals": patch
"@solidjs/diagnostics": patch
"solid-js": patch
---

Responsiveness thresholds and the LONG_HOLD diagnostic.

- `SILENT_HOLD` defaults tighten to `holds: { infoMs: 100, warnMs: 200 }` (from 300/500): RAIL's "feels instant" ceiling and the INP "good" ceiling. The engine measures to the commit, not the paint, so every number is a floor on what the user saw; the console's thresholds now sit at the strict end of the band.
- New `LONG_HOLD` (`responsiveness` kind): an acknowledged hold whose quiescent tail — from the last write to join it to the commit — reached `longHolds.infoMs` (default 500ms), `warn` from `longHolds.warnMs` (1000ms). Measured from the last join so a hold that keeps taking input is judged by each wait, not its lifetime. The repair is a fallback: a `Loading` boundary keyed with `on` (a revealed boundary without `on` keeps the old content — that is the hold), a fresh boundary, or making the data fast. A silent long hold stays one `SILENT_HOLD` with the same repair appended and `data.long: true`.
- `HoldEvent.tailMs` added; `holdMs` now runs from the interaction dispatch or the first parked flush, whichever is earlier (a node rewritten mid-hold keeps only its latest record, so the flush clock keeps the first wait from being forgotten). `ChangeRecord.at` stamps root writes.
- `feedback().sources[].late/lateMs` replaced by `long/longMs`: holds whose tail reached the long-hold threshold, acknowledged or not.
- `@solidjs/diagnostics` artifact format version 3 (`tailMs` on holds, `long`/`longMs` on sources); hold evidence in assertion failures includes `tailMs`.
- `RerunEvent.phase` value `"transition"` renamed to `"held"` (`"plain" | "held" | "optimistic"`) — the dev surface uses one word for the state.
