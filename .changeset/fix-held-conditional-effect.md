---
"@solidjs/signals": patch
---

Conditional JSX across a held branch change stays coherent with its inputs (#3438).

An effect's dependencies are the committed frame's until its run applies — the effect twin of the memo rule from #3410. A pass that direct-committed its value but whose run was stashed with a hold (the same flush pended an async memo) used to trim the dependencies its previous run still displayed, so a later mainline write to one of them never reached the effect: `{show() ? count() : "hidden"}` held on `show → false` showed `Count: 1` beside `Panel: 0` while `Show` still read `true`. The trim now waits for the run to apply, so the write re-derives the effect against the committed inputs (`Panel: 1` beside `Count: 1`), and the hold's landing reveals `hidden` with `Show: false`.
