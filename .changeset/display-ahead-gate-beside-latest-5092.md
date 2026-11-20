---
"@solidjs/signals": patch
---

A display-ahead `<Show when={latest(...)}>` and the ternary that `lowerShow` compiles it to now give the same screen while the write that opens the branch is held (#5092). A `latest()` text beside the gate reads ahead in both forms, and only the gate's branch keeps its fallback until the landing. The `<Show>` component no longer attaches its branch with the hole empty under `<Loading>`.
