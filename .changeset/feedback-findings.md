---
"@solidjs/signals": patch
---

Three responsiveness findings from facts `feedback()` already counted, emitted as they happen: `ABANDONED_FLIGHTS` (one source abandoned 3+ flights in a second — the request-per-keystroke signature), `FALLBACK_FLASH` (a `Loading` fallback shown under 150ms), `STACKED_HOLDS` (3+ interactions waiting in one hold when it committed). New `AttributionOptions`: `abandonedFlights`, `fallbackFlashes`, `stackedHolds`; `FALLBACK_FLASH_MS` is exported.
