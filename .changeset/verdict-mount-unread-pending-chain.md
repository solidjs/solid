---
"@solidjs/signals": patch
---

A `<Loading>` that a verdict reader (`<Show when={latest(x) ?? x()}>`) mounts reveals its content when a component inside it writes a signal during its mount and a memo that stays pending with no reader reads it through other memos (`gate = createMemo(() => version())`, then a memo over `gate`), at any depth: that memo holds nothing and reaches no boundary. #4203's fix covered only a memo reading the written signal directly (#4340).
