---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Direct `value`/`checked` (and other stateful DOM property) bindings no longer overwrite pre-hydration user input during the hydration claim pass (#3182). Hydratable compiled output now routes locked DOM properties through `setProperty`, which skips writes on hydrating nodes and carries the `<select value>` microtask and input/textarea nullish special cases.
