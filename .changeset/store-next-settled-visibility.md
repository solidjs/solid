---
"@solidjs/signals": patch
---

Store: pending-value visibility in the rewrite mirrors core's #3006 rule —
CHILDREN_FORBIDDEN execution scopes (createTrackedEffect / onSettled
callbacks) read committed values, so a store write inside onSettled parks
and an immediate read returns the settled value, matching signals.
