---
"@solidjs/signals": patch
---

fix(signals): a staged store error read from a bare owner (a `<For>` row update) no longer links it as a computation, so `<Errored>` gets only the fetch's error (#4805)
