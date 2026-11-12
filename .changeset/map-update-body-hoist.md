---
"@solidjs/signals": patch
---

`mapArray` and `repeat` run their update pass in a module-level function instead of an arrow function created on every pass. V8 keeps optimized code for a closure only while an instance of it is alive, so each major GC discarded the list update's optimized code and the next passes ran in the baseline tier. Appending one row to a 500-row list right after a major GC goes from about 26 µs to about 4 µs. No behavior change.
