---
"@solidjs/signals": patch
---

Optimistic store truth-flights now own their transaction (#3146): the flight declares it on the family at the ask (recording the causal transaction, or opening one when a stale stamp bare-returned the pre-throw entry), registers itself as its own async reporter so the transaction lives exactly as long as the question is unanswered — observed or not — and renews it per settle event. Bare optimistic writes (#2951) and landings route into the declared transaction instead of whatever stamp last brushed the firewall, and the transitionBlocked store-half checks declared ownership instead of reconstructing it from `_optimisticStores` membership.
