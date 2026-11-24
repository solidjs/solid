---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Keep `<Show>` as a component when `wrapConditionals` or `memoWrapper` is off, so its children are no longer re-created each time `when` changes between truthy values.
