---
"@solidjs/web": patch
---

Server bundles that don't serialize no longer retain the serializer's plugin set. Five module-level statements that Rollup shakes but Rolldown (Vite) and esbuild keep are now side-effect free to every bundler: the frozen `DEFAULT_WEB_PLUGINS` array is `/* @__PURE__ */`-annotated, seroval `Feature` flags are read on use, the stub gap-fill header set is built on first use, the event-stream heartbeat's `new TextEncoder()` is annotated (and no longer built at import time by `dist/server.js`), and the flash-cookie matcher is a regex literal. A server bundle importing only `isServer` or `getRequestEvent` drops from ~11.7 KB to ~1.6 KB minified (seroval bundled; Rolldown), and `renderToString` bundles shed ~260–380 B. No behavior or API change.
