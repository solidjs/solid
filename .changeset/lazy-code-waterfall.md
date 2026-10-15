---
"solid-js": patch
---

`SSR_BOUNDARY_WATERFALL` no longer counts render passes that waited only on `lazy()` code. On a cold server, nested lazy route chunks resolve one level per pass even though the router starts every matched level's import together, so the first request after a dev-server start (or after an edit) warned about a data waterfall that wasn't there. Data waits are still counted, and the message names any code waits it left out (`data.codePasses`).
