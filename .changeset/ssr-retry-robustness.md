---
"solid-js": patch
---

SSR robustness against pathological retry loops (SSR stack-overflow diagnosis amplifiers). `lazy()` now memoizes `resolveAssets(moduleUrl)` per request via an internal `HydrationContext` map — component bodies re-run on every suspended render pass, and dev-server manifest resolvers do real work per call, so re-asking multiplied that work by the retry count times every lazy() on the page (only the resolution is cached; per-boundary asset attribution is unchanged). And real errors surfacing during boundary/root-hole retries are now contained instead of escaping as unhandled rejections that kill the process: `finalizeError` routes handler-less errors through the renderer's new `failRender` seam (report via the render's `onError`, wind the render down), and `ssrHandleError` no longer masks the original error with a `NoOwnerError` when a retry pass re-pulls a hole from an ownerless flush microtask.
