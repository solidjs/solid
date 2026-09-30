---
"@solidjs/signals": patch
---

A re-run that commits `undefined` is no longer counted as waste. A projection that mutates its draft or reconciles a returned value, or a memo that does its work by writing a signal, has no output to compare, so its re-runs were reported as pure cost. `RerunEvent.changed` now reports `true` for these runs (as it already did for side-effect-only effects), so `WASTED_RECOMPUTE` no longer fires for them and `costs().wastedMs`, `expectNoWaste` and the performance tracks stop counting them as wasted.
