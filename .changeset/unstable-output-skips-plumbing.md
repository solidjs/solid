---
"@solidjs/signals": patch
---

`UNSTABLE_MEMO_OUTPUT` skips HMR plumbing memos (`CONFIG_PLUMBING`), as the re-run checks already did through `excludedNode`. The refresh wrapper's memo is a dev-only hop the developer cannot act on.
