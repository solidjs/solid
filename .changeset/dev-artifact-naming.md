---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
---

Rename the three legacy client dev artifacts to the `<entry>.dev.{js,cjs}` convention every other dev build already uses: `solid-js/dist/dev.*` → `dist/solid.dev.*`, `@solidjs/web/dist/dev.*` → `dist/web.dev.*`, `@solidjs/universal/dist/dev.*` → `dist/universal.dev.*`. With server dev builds now shipping as `dist/server.dev.*`, a bare `dev.js` no longer says which entry it is the dev build of. The `exports` maps are updated; only code deep-importing `dist/dev.js` directly (bypassing `exports`) is affected.
