---
"@solidjs/signals": patch
"solid-js": patch
---

`createDeferred(fn, options?)`: an async memo that may lag, but never leads. Before its first answer it is an ordinary async memo (readers suspend to `<Loading>`, or `loadingValue` shows). After it, a refetch holds nothing: readers keep the previous answer until the new one lands, the rest of the screen moves on, and `isPending` reports the refetch on the node and on everything derived from it, store keys included. A refetch that read a held value lands with that hold. A rejection errors like any memo. `refresh(d)` is a quiet re-ask, and `await refresh(d)` and `until` wait for the landing. It is `createMemo` on the server and hydrates like one.

The rules: F-1 and F-2 are amended for declared lag, and D-40 / S-41 are new. The `affects()` mark core moved to its own module (`affects-marks.ts`), which `createDeferred` shares. A mark on the source of a derived store now covers that store's keys.
