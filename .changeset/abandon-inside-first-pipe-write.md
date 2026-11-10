---
"@solidjs/web": patch
---

`renderToStream().pipe()` no longer throws `buffer.flush is not a function` when the render is abandoned from inside its first write (#4745). With a shell of 16384 characters or more, a pre-flush redirect in `createSSRResponse`, a sink whose `write` throws or a `signal` aborted from inside that write left `pipe` flushing a buffer that had no `flush`, and the unhandled rejection ended the process under Node's default handling.
