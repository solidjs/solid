---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
"@solidjs/h": patch
"@solidjs/html": patch
---

**Breaking:** all runtime packages are ESM only and declare `engines.node >= 22.12`.

Every `.cjs` artifact, every `require` branch in the exports maps, and the `types-cjs/` declaration mirrors are gone. Node 22.12+ loads ESM through `require()` natively, so a CommonJS host resolves the same files through the same export conditions it always did (`browser`, `node`, `development`, `observe`, …) — there is one module graph per tier rather than two to keep in step. `main` now points at the ESM server entry.

For consumers:

- ESM apps, Vite, Vitest, Bun, Deno, workers: no change.
- CommonJS Node apps: require Node 22.12 or later. `require("solid-js")` keeps working.
- TypeScript CommonJS projects: use `module: "NodeNext"` (TS 5.8+), which type-checks `require()` of ESM packages; `module: "Node16"` will report TS1479.
- Jest: needs Node 22.12+ for `require(esm)`; any preset that maps specifiers to `.cjs` paths (as `solid-jest` does for Solid 1.x) has nothing to map to and must be updated.

`@solidjs/signals` drops its flat `dist/node*.cjs` builds; its ESM entries (`dist/prod/`, `dist/observe/`, `dist/dev.js`) are the only ones. `@solidjs/babel-plugin` and `@solidjs/compiler` (build-time tooling loaded by Babel/Node) are unchanged.
