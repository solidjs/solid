---
"@solidjs/signals": patch
---

A pass that asks and reads ahead runs on the screen as a sync pass does (S-51 re-ruled 2026-11-12; F-2, F-6, D-25, #4778). An async memo that reads a held value beside `latest()`, `isPending()` or a guess of it now answers the screen's question for the display — `0/true`, `0/1` beside the screen's `id` — and the landed world's question for the frame, so the write never shows beside another question's answer. The 2026-11-07 producer clause ("a question is asked only of the truth") is withdrawn: under it `isPending(id)` read `true` beside an async label computed from `false`, and a wrapped async reader (`memo(() => asyncMemo())`) behaved differently from an inline one.

The hold waits for the answer to its own question. The request the frame's pass sent is the hold's question; the hold waits on it while a reader on screen does, whatever the screen's pass came to (before, a faster screen answer could land the write ahead of its data). A second write while that request is up supersedes it: the reader asks the new question at once instead of at the landing, and never ends on the first write's answer (on `next`, `async(source(), memo(latest(source)))` did). A window extracted into a memo reads as inline for an async reader over it, in either read order.

A derived store whose derive reads such a memo shows what the memo form shows (D-30).
