---
"@solidjs/signals": patch
---

Reconcile the patch channel with the #3164 fold ruling: the branch's landing-consumption integration (landing emission hook, superseded-work generation stamps) is deleted with the contract it served — under fold, staged truth rides the channel's existing transition-held write semantics and the atomic reveal rides the settle drain's resync loop. Re-applies the primitive-owned emission gate the rewrite reverted (local-consumer-list gating silenced ancestor channels) and re-pins the landing invariants to fold semantics: interim landings under retained optimism are invisible to value and structural channels alike, with the flip atomic at settle, at classic-effect parity.
