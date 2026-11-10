---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Production builds compile a `<Show>` that needs no component to the ternary it renders: no `keyed`, no spread, only `when` and `fallback`, with JSX children or a one-parameter callback whose `when` is a plain read (each `u()` reads `when` again). Dev builds keep the component and its stale-read error. The `lowerShow` option overrides the default (`!dev`). The native compiler's SSR pass also no longer returns a TSRX module's static templates unescaped when one element in the module is marked as safe.
