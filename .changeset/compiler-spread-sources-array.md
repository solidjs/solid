---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Native elements with several spread sources compile to the runtimes' array form instead of a `mergeProps()` call, in DOM and SSR output: `<div id="x" {...a} {...b}>` becomes `spread(el, [{ id: "x" }, a, b], …)` on the client and `ssrElement("div", [{ id: "x" }, a, b], …)` on the server. The runtimes read the sources directly — later sources win per key, only the winning source is read — with no merge proxy to build and walk, and a reactive spread is a plain thunk called inside the tracking scope, so it mints no memo and consumes no hydration id on either side (the hydratable SSR `() => mergeProps(…)` wrapper is gone for the same reason). A lone spread still passes straight through (#3105). Requires `@solidjs/web` with the `spread`/`ssrElement` array forms (#3418, #3419).
