---
"@solidjs/signals": patch
"solid-js": patch
---

Attribution: transition holds and the `SILENT_HOLD` diagnostic.

When a write lands on async work the runtime holds it until the data settles — correct, but from the user's side the click did nothing until then. The attribution engine now records every such hold that staged a root write (`DEV.attribution.holds()`: duration, parked flushes, the held writes with their values, the async blockers, and which affordances answered it), and emits `SILENT_HOLD` when the screen provably rendered no acknowledgment: no `isPending()`/`latest()` reader anywhere downstream of the held writes or their blockers, no optimistic value, no `affects()` mark, and no effect ran inside the parked flushes. The verdict is tiered by `holds: { infoMs, warnMs }` (default 300/500ms): advisory on the structured channel, then a console `warn` naming the write, the blocker, and the concrete repair — `isPending(() => blocker())`, `latest(source)`, or `createOptimistic` for actions. Holds with no root write (initial loads, bare `refresh()`) are never judged.

New dev hook points on the core (`effectRun`, `holdStart`/`holdEnd`, `transitionSettled`, `transitionMerged`) sit outside every `try` and fold out of prod — verified byte-identical against the size scenarios. `DiagnosticKind` gains `"responsiveness"`; `solid-js`'s console footer teaches the attribution surface for it, and the reactivity-diagnostics skill documents the repair.
