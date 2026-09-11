---
"@solidjs/signals": patch
---

fix(signals): a reveal of a foreign-held flight shows the committed value unless the flight's inputs are visible; a same-value re-prediction renews the override's provenance

The A15 reveal corollary is re-ruled (review on #3347): a stale (render) reader that lands on a node pending in another transaction shows the node's committed value, does not entangle the two transactions, and re-derives at that transaction's commit — parallel transactions, effects don't entangle. The reveal holds on the flight only when the committed value would tear against the frame: the flight's inputs were published while it was pending (`CONFIG_INPUTS_PUBLISHED`, set by a commit that leaves the node in the air, #3305), the node rides a live lane (optimistic / `latest`, #3334), or the node is uninitialized. An effect recorded for a transaction's commit replay that later recomputes under that transaction drops the stale recording (it is applied by the commit itself). GabbeV's "revealed reader never catches up" and "conditional reader stays hidden" shapes are pinned.

A same-value optimistic write by a newer action now renews the override's provenance stamp on the fast path, so an older action's slow answer no longer supersedes a value the user just re-confirmed (#3331 follow-up).
