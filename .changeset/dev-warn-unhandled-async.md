---
"solid-js": patch
---

Add dev-mode error when async content is used in JSX without a `<Loading>` boundary during `render()`. In dev, the app is unmounted and an error message is rendered into the container. Re-export `setOnUnhandledAsync` hook from `@solidjs/signals`.
