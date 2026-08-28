---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Re-audit-7 runtime hardening, invariant-tested: adoption demotion probes the
incoming backing statelessly (sticky scan flags no longer trusted across
swaps), prototype-accessor records (class instances) reject patch admission,
normal and optimistic queues coalesce on separate stamps, structural queue
entries snapshot their consumers at emission while value entries resolve the
live list at drain (a consumer list recreated during a held transition or
merge receives the commit exactly once, effect parity), released entries
from independently-settling transitions coalesce per channel, shallow slot
rebuilds are build-before-destroy (a throwing replacement leaves the old row
mounted AND live), and a hydration claim failure surrenders the list's
entire server region including trailing unclaimed rows.
