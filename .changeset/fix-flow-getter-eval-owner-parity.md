---
"solid-js": patch
"@solidjs/web": patch
---

Fix hydration id drift from allocation-capable prop getters in flow controls (#2976)

A compiled conditional prop (`when={a ? x : b ? y : null}`) allocates a
condition memo every time the getter is evaluated, under whichever node is
reading. The server flow controls compensated for the client's internal memo
slots with bare id burns, but evaluated the getters themselves under a
different internal node than their client twins — so the getter's allocation
landed in a different owner's id space on each runtime and drifted every
hydration id assigned after it (unclaimed nodes, dead bindings).

The server twins now evaluate each such getter inside a real node at the
same child slot as the client: Show reads `when` through a mirrored
conditionValue memo, Switch evaluates each Match's `when` inside per-match
conditionValue memos under a mirrored switchFunc memo, and mapArray/repeat
give the row id space its own owner at slot 0 with the memo at slot 1 so
`each`/`count`/`from` getters evaluate where the client's computed node
evaluates them (previously the allocation also shifted the row id base).
Dynamic and boundary fallback getters were audited and already aligned. The
compiler output is unchanged. Adds parity-harness scenarios for Show
(dynamic + static), Switch, For, and Loading fallback ternaries.
