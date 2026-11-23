---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Keep an element reference for static props that compile to runtime writes, so a nested static `<select value>` no longer crashes the Babel plugin and the native compiler no longer writes a static select `value`, or a `selected`, `checked`, `value` or `muted` beside its `default*` prop, to the previous sibling (also a static `style` with `inlineStyles: false`).
