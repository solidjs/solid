---
"@solidjs/signals": patch
---

`mapArray` (and `<For>`) copies its source list once at the start of a pass and diffs that copy, instead of reading the list throughout the pass and copying it at the end. A deep store list answers every slot read through a proxy trap, so each slot went through the proxy three or four times per pass and now goes through once. Removing 100 scattered rows from a 1,000-row store list goes from about 0.82 ms to about 0.72 ms, and bundles with `mapArray` are 23 bytes smaller minified. A plain array does the same single copy as before, earlier in the pass.
