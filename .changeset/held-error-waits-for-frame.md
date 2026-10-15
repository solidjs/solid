---
"@solidjs/signals": patch
---

An error is an answer: it ends the wait like a value, and it shows when a value would (D-41). A rejection or throw on a node a transaction holds is staged and published with the frame that carries it: until then the screen, an untracked read, `createEffect`'s error arm and `<Errored>` keep the previous frame, `isPending` is `true`, `latest` throws the proposed error, and `resolve`/`until`/`refresh` reject at the landing. A held recovery keeps the shown error until its own commit, and a recovery equal to the last good value now reaches effects, held or not (it was swallowed by the equality gate). Replaces the separate staged-error publish path. From #3886's audit (GabbeV).
