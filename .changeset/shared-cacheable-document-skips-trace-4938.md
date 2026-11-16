---
"@solidjs/web": patch
---

An SSR document a shared cache may store (`Cache-Control` with `public` or `s-maxage`, or a storable `CDN-Cache-Control`) no longer tells the browser the request's trace: no `<meta name="traceparent">` in the shell head and no trace entry in `Server-Timing` (#4938). The cache replays one response to every viewer, so each browser attached its spans to the request that filled the cache, and the per-request meta tag changed the body on every render, which defeated `ETag` revalidation. The decision reads the response head when the shell head is written, so an `httpHeader("Cache-Control", …)` set while the shell renders counts. Server-function reads already worked this way (#3985). `getTraceContext()` is unchanged.
