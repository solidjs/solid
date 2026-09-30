---
"@solidjs/signals": patch
---

`WASTED_RECOMPUTE` no longer counts a re-run that committed `undefined` as waste. A projection that mutates its draft, or a memo that does its work by writing a signal, has no output to compare, so its re-runs were reported as pure cost.
