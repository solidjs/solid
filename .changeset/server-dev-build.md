---
"solid-js": patch
"@solidjs/web": patch
---

Add development server builds — `dist/server.dev.*` for `solid-js` and `@solidjs/web`, and `frames/dist/server.dev.*` — selected by the `development` export condition nested under `node`/`worker`/`deno` (nesting is required: those conditions precede the top-level `development` key, so a top-level entry never matched on a server). Until now SSR had no dev build: the only server artifact was built with `_SOLID_DEV_` stripped, so the server runtime's dev checks (head/preload descriptor validation, `useHead` warnings, the committed-response header guard) never ran outside the test suite.

The server entries now gate their public dev flags on the same `_SOLID_DEV_` replace as their internals instead of hard-coding them: `solid-js`'s server `DEV` is `@solidjs/signals`' `DEV` object in the dev artifact (so `DEV.diagnostics.subscribe`/`capture` work server-side) and `undefined` in prod; `@solidjs/web`'s server `isDev` is `true` in the dev artifact and `false` in prod.

Behavior change for dev SSR hosts that pass the `development` condition (Vite dev does by default): a header write after the response has committed now **throws** with the offending header named, where the production artifact continues to `console.error` and drop the write.

Also runs `replaceDev(false)` on `solid-js`'s production server build so a future `_SOLID_DEV_` gate in `src/server/` cannot constant-fold into the dev branch in production.
