---
"@solidjs/babel-plugin": patch
---

`sourceNames` gains a `locations` kind (and the plugin a `root` option): component and binding labels carry a `file:line:col` for diagnostics. `createComponent(Home, props, "Home", "src/App.tsx:12:5")` points at the `<Home` opening element (DOM and SSR output); a binding's options gain `loc` after `name` — the attribute's start for an attribute effect (a merged effect points at the first attribute it lists), the hole's `{` for an insert — and a spread passes it after the tag (`spread(el, props, false, undefined, "div", "src/App.tsx:20:12")`). The path is relative to `root` (default: the working directory) with `/` separators; line and column are 1-based, so a dev server links the location straight to the source. Like the other kinds, `locations` follows `dev` when unset, `true` turns every kind on, and the object form picks; a location is only emitted beside its label, and never when Babel has no `filename` for the module.
