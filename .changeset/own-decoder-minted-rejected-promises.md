---
"@solidjs/web": patch
---

Own every promise the server-function decoder mints. A rejected promise decoded out of a peer's payload — a rejection frame arriving mid-stream, or an atomic rejected-promise node settling synchronously during decode — had no owner when the consumer never read (or abandoned) the slot, and escaped as an unhandled rejection that ends a Node consumer under its default policy. The decoder now attaches a noop rejection handler at mint time, mirroring the encode side's `guardedPromise` ownership (#3216); real consumers still observe the rejection unchanged.
