---
"@solidjs/signals": patch
---

Structural-audit follow-up on the patch channel: slot-patch registrations now carry the registration-sequence stamp (shallow lists mounted during held windows resynced instead of staying stale), landing consumptions notify structural consumers with drain-time resolution instead of an emission-time draft snapshot (classic-parity by construction across back-to-back continuation landings), late-registrant resyncs dedup per drain, and the superseded-work gate re-resolves standalone slot ticks live instead of dropping them. Two upstream continuation-reckoning findings (same-microtask landing swallowed; until()-gated action wedged on the swallowed echo) are pinned as expected-fail tests for the #3123 seam.
