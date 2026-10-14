---
"@solidjs/signals": patch
---

A memo that reads a verdict memo (`isPending`/`latest`) shows the verdict now, beside a held value it also reads (F-6, U-10, #4050). Before, it re-entered the hold with that value and the verdict waited for the landing: a Provider's children memo over a router shell `[<Feedback/>, outlet]` never showed delayed pending feedback during a held navigation. It now behaves as the same probe read inline, or a render effect reading both, already did.
