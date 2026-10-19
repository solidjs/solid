---
"@solidjs/signals": patch
---

A child under a non-keyed `<Show>` no longer re-runs after its condition goes falsy inside an open action (#4137). When the branch is lane work — its row was added by an optimistic write — and a later pass of the same lane withdraws it, the Show parks the branch as a lane frame (#3698): it stays on screen until the lane's apply retires it. The condition's re-staging marked the parked child as the lane's work, and since the L2 rewrite (rc.14) a lane-dirty zombie ran at once, so the child read the Show's narrowed accessor after the selecting read went falsy ("Attempting to access a stale value from <Show>") and, without an error boundary, halted the reactive system. A lane frame's member now follows mainline writes only: a lane dirty on a zombie whose parking owner is lane work is cancelled. A transaction's zombie a lane reveals through still runs for the lane (#3463).
