---
"@solidjs/signals": patch
---

A display-ahead `<Show when={latest(...)}>` and the ternary that `lowerShow` compiles it to now give the same screen while the write that opens it is held (#5092). The `<Show>` component no longer attaches its branch with the hole empty under `<Loading>`, and a `latest()` text beside the gate reveals with the landing in both forms, as the branch does.
