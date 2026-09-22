---
"@solidjs/signals": patch
"solid-js": patch
---

Loading `on` follows the frame (#3540). When a dependency of `on` changes, the boundary still stops waiting on its current content immediately — the frame no longer waits for it — but its fallback swap now lands with the same frame as the change that caused it, instead of in the current frame beside content the change is still holding. Navigating product A → B inside an action (or by a write whose async is in flight) with the shell reading `product(id)` outside a `<Loading on={id()}>` that reads `comments(id)` goes `[A] → [B + spinner] → [B + comments]`, not `[A] → [A + spinner] → [B + spinner] → [B + comments]`. If the comments land before the shell, no fallback is ever shown. Nothing else holding the frame, the fallback and the committed change land together in the same pass, as before.

Read `latest()` in `on` (or any display-ahead state: `isPending()`, an optimistic signal) to keep the previous behavior — the fallback shows now, beside the still-held frame.

If the same data the boundary is waiting on is also read outside it, the frame waits on that read and no fallback appears; DEV warns `LOADING_ON_OUTSIDE_HOLD` with the fix (read `latest()` in `on`, or move the outside read under the boundary). The same code fires after the fact when the write's action outlasts the data — nothing outside reads the source, but the action parks the frame past the content's landing, so the fallback is never displayed (a frame held by other data is a race, not a warning). `Errored`'s `on` retry is unaffected: it runs mainline — content now, the action's other writes later.
