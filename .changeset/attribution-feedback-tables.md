---
"@solidjs/signals": patch
"solid-js": patch
---

Attribution: `feedback()` — what the user waited on, as ranked tables.

`DEV.attribution.feedback()` is a pure fold over the records the engine already keeps — `holds()` and the interaction on each re-run — with no measurement or hook sites of its own, the way `costs()` folds re-runs into scope and write tables. `sources` ranks each set of async sources that held writes by the silent time spent behind them, with `holds`/`heldMs`/`worstMs`, `silent`/`silentMs`, `acknowledgedBy` (which affordance answered and in how many holds — a source acknowledged on one screen and silent on another reads as exactly that), `latestOnly` (answered only by a `latest()` shadow), the `interactions` that were held, the distinct `writes`, and `actions`. `interactions` ranks user events (type + target; repeated dispatches fold together) by total cost, pairing the synchronous re-run work one dispatch caused (`runs`, `selfMs`, `worstDispatchMs` — the long-flush hazard) with the time its writes spent held (`holds`, `heldMs`, `silentMs`, `worstHoldMs` — the silent-hold hazard): the two INP failure modes as columns of one row. Every hold counts at any duration; `SILENT_HOLD` remains the thresholded verdict over the same records. New exported types `FeedbackSource` and `FeedbackInteraction`; the reactivity-diagnostics skill gains a "where to start" entry, and `solid-js`'s console footer names the surface.
