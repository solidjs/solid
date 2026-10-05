---
"@solidjs/signals": patch
---

A memo pulled by an `isPending`/`latest` probe computes as its own pass, outside the probe's window: it no longer caches the committed input in place of a flushed write (fuzzer F10), or reads an uninitialized input as `undefined` instead of suspending (F11).
