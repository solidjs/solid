---
"@solidjs/signals": patch
---

Size audit (measurement branch): §41.4 benchmark fixes. A plain pass already marked as having read this flush's staging reads an unheld container staging directly — the per-key "did this key change" question is asked once per pass, not once per key (a `mapArray` over 1k shifted rows asked it 1k times; store array ops `splice`/`shift`/`unshift`/`reverse`/`push` on 1k proxied rows now at parity with `next`). At the fold, a child whose parent was adopted whole no longer re-resolves its slot by an O(rows) `indexOf` that cannot hit (the slot already holds the child's new backing).
