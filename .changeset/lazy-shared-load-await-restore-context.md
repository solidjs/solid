---
"@solidjs/web": patch
---

An awaited `renderToStream()` that re-pulls root holes — as happens when a `lazy()` component's first load is shared across concurrent renders — now restores the render's `sharedConfig.context` first, the same restore the streamed path already performs in `doShell`. Without it the resumed render body runs under whichever concurrent render set the global last, so an async memo created there records into (and adopts from) another render's slot store and concurrent requests can read each other's values (#4595).
