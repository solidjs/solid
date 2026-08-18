---
"@solidjs/signals": minor
---

Store rewrite: the derived writable `createStore(fn, seed)` form serves from
the rewrite (projection internals + a recompute-masking setter). The §6c
status gate now covers errored derives (memo parity) and only guards raw
fallthrough — tracked reads link through firewall-backed nodes in core
read(), so landings wake async-memo readers exactly like legacy. Has- and
key-set nodes carry the firewall link too.
