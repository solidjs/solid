---
"@solidjs/signals": patch
---

Attribution: fold hot-scope spam into a culprit-keyed aggregate. HOT_SCOPE_RERUNS blames the victim scope, so one hot cause fanning out over many scopes (a selection write re-running every row, a timer leaking into a list) produced N warnings for one culprit. Now the first scope to go hot for a given root-cause key warns as before (single hot scopes keep exact current behavior), subsequent scopes in the same window are counted silently, and scope-count milestones (5, then 10x) emit one escalating HOT_SCOPE_FANOUT diagnostic naming the shared cause.
