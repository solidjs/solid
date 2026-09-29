---
"solid-js": patch
"@solidjs/web": patch
---

`lazy()`'s `preload()` and `moduleUrl`, and `getTraceContext()` outside a request scope, resolve the caller's own render instead of the global SSR context

Both read the module-global `sharedConfig.context`, which is whichever render started or finished last. A `preload()` or `moduleUrl` read made outside the component's own render pass (a route data function, code after an `await`) registered its modulepreload/stylesheet hints into, and resolved its URL through the manifest of, whatever render held the global, possibly another concurrent request's page. An unscoped `getTraceContext()` read the same way could return another render's trace. Both now resolve the render through the caller's owner, walking to the render root the renderer claimed. A call no render can be attributed to hints nowhere, and `moduleUrl` returns the raw specifier and `getTraceContext()` returns `undefined`. The component's own render still registers its assets when it mounts. A render's `"render"` observe record settles under the render's root owner, so its listener still reads that render's trace.
