---
"@solidjs/signals": patch
---

Store setter drafts on plain-data objects now open as prototype-chain overlays of the committed backing instead of descriptor clones (#3044): O(written keys) per flush instead of O(container size), fixing the quadratic blowup when repeatedly writing few keys into a wide store (4000-key repro: 1421ms → 6ms). Commit flattens the overlay onto an owned committed backing in place (privatize-once for user-ingested objects — the never-mutate-user-data contract holds); deletes track aside and read as absent; reconcile, snapshot, and drafts escaping into other storage materialize to the proven clone path. Arrays, projection/optimistic families, and accessor-bearing containers keep the clone path.
