---
"@solidjs/signals": patch
---

Store rewrite: shallow stores serve from the rewrite. Slot values are stored
verbatim (proxies pass through by reference, #2932) and served raw; ingest is
sticky raw-marked at creation, set-trap, and reconcile adoption (the
never-both-wrapped-and-raw invariant); reconcile on shallow targets is the
slot-granular positional diff with no descent. In-process A/B holds legacy
shallow's dbmon performance at parity.
