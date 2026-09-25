---
"@solidjs/web": patch
---

`serverFunctionUrl` refuses a `live` reference. Its call is a standing connection at the live address, so no url describes it as a value: a preload of the live address would open a stream nothing reads, and the data address the helper used to return answers a different call (one render, closed). Warm the address by calling the reference (readers of one call share one connection), or render the one-shot url from the `GET(fn)` declaration inside the `live` wrapper. `GET` server components end to end (GET at the data address, event stream at the live address, the grant, the POST fallback) are pinned by tests.
