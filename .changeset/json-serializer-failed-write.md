---
"@solidjs/web": patch
---

`createJSONSerializer` settles a write whose value fails to parse, whether the failure is thrown or reported through `onError`, and releases what that write had already parsed. `onDone` now fires after `flush()` instead of never, so a frame stream whose client prop cannot be serialized completes, with the other records delivered.
