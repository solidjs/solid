---
"@solidjs/signals": patch
"@solidjs/diagnostics": patch
---

Attribution: `feedback()` gains the fact tables that have no verdict of their own. `flights` counts, per async source, flights started, landed, and abandoned (superseded by a newer flight before landing — the re-ask-on-every-keystroke signature) with landed wall time. `fallbacks` measures, per loading boundary (named by owner path), how many times and for how long its fallback was shown and how many shows were sub-150ms flashes — the other end of the SILENT_HOLD spectrum. `sources` rows gain `late`/`lateMs`: acknowledged holds that still ran past `holds.infoMs`, where the affordance is not the whole answer. New `AttributionHooks.boundaryFallback` hook point at the boundary's source-set transitions. `@solidjs/diagnostics` exports the `FlightStats` and `FallbackStats` types; artifacts and the bridge carry the new tables through the existing `feedback` field.
