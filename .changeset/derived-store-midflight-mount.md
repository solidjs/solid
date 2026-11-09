---
"@solidjs/signals": patch
---

A reader of a derived store that mounts while the derive's input is in flight is held until it answers, as a reader of the async memo is, instead of showing the previous answer first: `createStore(d => { d.v = m1() })` over a memo that reads `latest()`, read mid-flight, no longer shows the old question's value before the new one (#4491).
