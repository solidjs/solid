---
"@solidjs/signals": patch
---

An optimistic store's guess is one node per setter per lane: the guess carrier, whose value is the setter's draft with the keys it changed recorded on it. Reads of a guessed key go through the carrier; a landing is judged against it over those keys. A rewritten or returned top-level array is one write per index that differs, as a returned object is one per key, and the list itself is the slot only when its keys or length changed. Two actions guessing into one list (a field edit and a whole-array rewrite alike) are two carriers in two lanes: a guess made while another action's refresh is in flight shows from its flush, and the refresh's failure is the list's answer and reaches `Errored` (#4724). The `OPTIMISTIC_REVERTED` finding names the guessed key.
