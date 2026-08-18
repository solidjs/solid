---
"solid-js": minor
"@solidjs/web": minor
---

`lazy()` and `clientOnly()` accept an `{ export }` option to select a named export of the resolved module (defaults to `default`). The export name is a call-site literal available in both bundles, so lazy hydration still resolves the component synchronously from the preloaded module — wrappers that pick an export at runtime inside the import thunk remain unsupported and now fail loudly in dev. `lazy()`'s bundler-injected `moduleUrl` moves to the third argument to make room, matching `clientOnly()`.
