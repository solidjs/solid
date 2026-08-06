---
"@solidjs/web": patch
---

Implement the `waitAsset` rxcore seam for client-side CSS reveal gating (dom-expressions `docs/client-css-reveal-gating.md`). During a transition or boundary reveal, the runtime's `useHead` warms a registered stylesheet as `rel="preload"` at discovery (overlapping the fetch with the data wait) and calls `waitAsset(loadPromise)` from the gating compute; the seam throws `NotReadyError` while the sheet is loading so the transition holds — content and its CSS reveal together, client parity with SSR streaming's `$dfs` gate. Loaded, errored, and cached sheets pass through without a wait. One detached async node per promise (WeakMap-shared across readers), created outside the calling compute so the retry it triggers can't dispose it and so it never consumes a hydration id from the calling owner chain.
