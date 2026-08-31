---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Round-10.6 audit fixes: direct object-valued manifest roots are alias-currency-probed (admission declines, payload-less deliveries demote), demotion re-drives schedule through held owner queues instead of force-running, and delivery dedup is transaction-scoped for both plain and optimistic bumps (repeats within one transaction skip; a different transaction always reaches the scheduler).
