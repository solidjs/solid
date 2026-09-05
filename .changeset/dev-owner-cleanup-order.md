---
"solid-js": patch
---

Keep `onCleanup` ordering consistent between development and production builds. In dev, components are wrapped in an extra owner scope for devtools; cleanups registered directly in a component body now register on the same owner they would have in production, so disposal order matches across build modes.
