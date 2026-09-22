---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/web": patch
---

`sourceNames.bindings`: compiled binding effects are named by what they write. An attribute effect gets `<tag>.<attribute>` as written (`span.textContent`, `div.class:active`, `div.style:color`; a template's merged effect lists all of its bindings), a hole's insert is named for the parent it fills (`div.children`), and a spread passes its tag so the runtime labels its attribute effect `div.spread` and its children insert `div.children`. The names travel as a trailing options argument on `effect`/`insert` (`{ name }`) and a trailing string on `spread`; `@solidjs/web`'s `effect`, `insert`, and `spread` accept them and put them on the render effect nodes, where the dev and observe tiers show them in owner paths, attribution chains, and the Propagation track — a binding effect reads `span.textContent ← count` instead of `effect ← count`. Production ignores the names; output with the option off is unchanged. DOM output only; `sourceNames: true` turns it on with `components`.
