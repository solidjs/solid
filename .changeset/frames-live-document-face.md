---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

Live server components on the document face (Stage 8 B3)

Server: a component a `live` server function answers with renders into the document under a live scope — every async source it reads takes its first value into the markup and is closed, so the document completes; nested server components inherit the scope. The scope is judged from the memo's owner, which also fixes an unbranded thenable-resolved stream in server-component scope serializing instead of pumping. New dev-only check `SSR_UNDECLARED_LIVE_SOURCE`: an undeclared async iterable still pumping five seconds into a document render is named (frame-stream renders are never judged).

Client: the frames intercept is consulted synchronously by `live()` and its answer rides on the iterable (`LIVE_LOCAL`); a hydrating `dynamic()` adopts it as its value at t=0 — no request, no pending beat — and takes over at its hydration scope's release, re-yielding the adopted binding and connecting once at the live address. A boundary the page is still delivering is answered with a promise that lands at its reveal, so a `dynamic(() => call())` over a streaming boundary waits for the document instead of fetching. `dynamic`'s memo treats the same server-component instance (same component and address) as equal, so placeholder and per-address binding never remount.
