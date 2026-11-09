---
"@solidjs/signals": patch
---

`createStore(fn)` that nothing reads no longer holds a plain write with its derive's flight: a derive over a `latest()`-reading memo observed the flight as a frame reader although its store had no reader.
