---
"@solidjs/signals": patch
---

A computed's error that halts the reactive system is rethrown as the error the user threw, not Solid's internal status wrapper. The wrapper carried the reactive node, so an error reporter (or a test runner) serializing the uncaught error walked the whole graph.
