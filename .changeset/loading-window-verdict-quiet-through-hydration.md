---
"solid-js": patch
---

Keep the loading window open through the `ssrSource: "client"` hydration gate. The gate's synchronous prev-return counted as the node's first real answer and closed the loading window, so the post-hydration compute — the node's actual first question — reported `isPending: true`, unlike the same source on a fresh CSR mount. The gate now returns a never-settling flight for loading-window sources (`loadingValue` / `seedLoadingValue: true`): commit #0 serves verdict-quiet until the first real flight lands, and only then does refetch work become pending-class. Signal and store families both.
