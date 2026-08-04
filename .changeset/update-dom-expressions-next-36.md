---
"@solidjs/web": patch
---

Update dom-expressions to 0.50.0-next.36 (identity split, fragment reveal ledger, identity-first morph grafts, held recordless-occurrence classification) and drop the temporary local runtime link. With the runtime now re-checking a recordless adopted occurrence until records can no longer arrive, the frames integration's `recordsPending` answers the actual question — parser still running (`document.readyState === "loading"`) or fragments still pending — instead of borrowing `boundaryMayArrive()`'s `!_$HY.done` term: holding classification until client hydration completes pushed adopted mounts past the hydrate window, where the claim adopted markup the client's state had already moved past.
