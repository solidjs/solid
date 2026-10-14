---
"@solidjs/signals": patch
---

A render reader whose pass errored (NotReady included) before reaching a flight it read last time still holds that flight's transaction: a write no longer shows beside a reader still derived from the previous value while the flight is in the air (fuzzer F4).
