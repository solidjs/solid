---
"@solidjs/web": patch
---

Contain flight-data collector errors per source: a throwing collector no longer fails the mutation response (the client received an error for a mutation that succeeded) or drop the other sources' slices — the failing source is simply omitted and logged.
