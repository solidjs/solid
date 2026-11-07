---
"@solidjs/signals": patch
---

`UNSTABLE_MEMO_OUTPUT` skips the nodes the re-run checks already skip through `excludedNode`: HMR plumbing memos (`CONFIG_PLUMBING`, the refresh wrapper's dev-only hop the developer cannot act on) and scopes excluded with `OBSERVE.exclude`.
