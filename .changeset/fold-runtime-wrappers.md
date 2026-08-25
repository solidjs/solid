---
"@solidjs/universal": patch
"@solidjs/web": patch
"@solidjs/h": patch
---

Fold render/hydrate policy into the runtime implementations, drop the duplicate `mergeProps` re-export, keep JSX type sources in `packages/web/jsx/`, and colocate the SSR package entry at `src/index.server.ts`.
