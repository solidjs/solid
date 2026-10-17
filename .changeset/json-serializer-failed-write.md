---
"@solidjs/web": patch
---

`createJSONSerializer` settles a write whose value fails to parse, whether the failure is thrown or reported through `onError`, and releases what that write had already parsed, including async iterables and streams it had started reading. `onDone` now fires after `flush()` instead of never, so a frame stream whose client prop cannot be serialized completes, with the other records delivered. The references a failed parse registered are dropped, so a later write that shares a value with it decodes that value instead of `undefined`. A `close()` called from a write's first record also stops that write.
