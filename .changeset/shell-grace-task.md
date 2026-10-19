---
"@solidjs/web": patch
---

`renderToStream` waits one task before flushing the shell while fragments are still pending, so a read whose retry chain outruns the microtask drain (a server function over in-memory data, a cache answering on `setImmediate`, I/O that already completed) renders inline instead of shipping its `Loading` fallback, a `<template>` and a reveal that shifts the page. Renders with nothing pending flush exactly as before; genuinely pending I/O pays one task of first-byte latency.
