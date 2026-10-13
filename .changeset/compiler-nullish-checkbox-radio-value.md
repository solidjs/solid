---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Non-hydratable client builds now remove the `value` attribute when a checkbox or radio input binds a nullish `value` or `defaultValue`, matching the runtime fix from #4009, so a checked box submits `"on"` instead of `""`. Both compilers route these bindings through `setProperty` when the input's static `type` is `checkbox` or `radio`, or when its `type` cannot be known at compile time (an expression, `prop:type`, `attr:type`). Text inputs, inputs without a `type`, and textareas still clear to `""` inline (#2957).
