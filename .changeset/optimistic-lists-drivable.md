---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Optimistic family arrays are drivable by the patch-mode list driver, completing the family channel: structural optimism (push/splice/reorder/replace in optimistic drafts) emits identity-diffed row ops at lane timing from the override channel — visible in flight, bypassing the transition stash like optimistic record patches — and reverts emit an identity RESYNC the driver resolves against the live post-revert view. The driver binds optimistic lists from the optimistic view (classic reads the same view through the proxy), and the identity-swap matcher is shared between swaps and resyncs. Equivalence matrix extended with async optimistic scenarios (mounted → in-flight → settled, revert and land, element-level and parent-key structural writes).
