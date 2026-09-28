---
"@solidjs/signals": patch
"solid-js": patch
---

`STRICT_READ_UNTRACKED` now fires in two places it was skipped (#3675). In `@solidjs/signals`, `read()` served a snapshot-scope reader the captured value and returned before the strict-read check, so a component body's direct read stayed silent during the hydration pass and only warned after client navigation; the check now runs first. In `solid-js`, `lazy()` rendered the loaded component through a bare `untrack()` instead of `createComponent`, so its body had no component label and its direct reads were never checked — and, in dev/observe builds, its owner carried no component name for diagnostics. It now renders through `createComponent`; production output is unchanged. The warning's console line also names the value that was read when it has a name — a signal's `name` option or the store key: `Reactive value "count" read directly in <Child> will not update.` (the `nodeName` field already carried it).
