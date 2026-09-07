---
"@solidjs/signals": patch
"@solidjs/web": patch
"solid-js": patch
---

Attribution: write provenance — who performed a change.

Every root `ChangeRecord` now carries `origin`: the imperative frame that made the write. `interaction` (a user event — type, described target such as `button#next "Next →"`, and dispatch time), `effect` (the callback's name), `action` (the generator's name), `async` (the landing's node), or `external` (timers, sockets, promise callbacks — including writes after an `await` rather than a `yield` inside an action, the documented transaction escape). Frames nested under an interaction carry it: an action a click started (every step, including post-`yield` resumptions), an effect whose run a click's write caused, an async flight a click's write launched. Why-chains print the origin after the write; `RerunEvent.interaction` and `HoldEvent.interaction` expose the interaction a run or hold traces back to, and `SILENT_HOLD` now opens with what the user did and measures the wait from the event, not from the first parked flush.

`@solidjs/web` declares the interaction around its two dispatch sites — delegated events (`onClick`, `onInput`, `onKeyDown`, pointer events: every INP-relevant type) and runtime-attached direct handlers (spreads, non-literal handler expressions) — via the new `DEV.attribution.withInteraction(ref, fn)`, which custom renderers and test harnesses can call themselves. New core dev hooks `effectRunStart`/`effectRunEnd` (replacing `effectRun`) and `actionStepStart`/`actionStepEnd`; all sites fold out of prod, verified byte-identical against the size scenarios.
