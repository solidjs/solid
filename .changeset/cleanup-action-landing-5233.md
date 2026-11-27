---
"@solidjs/signals": patch
---

An action started while a transition lands, from a cleanup (`onCleanup` or an effect's returned cleanup) or from an optimistic value's `equals`, no longer leaves the flush pointing at the landed transaction. Before, the next action merged into it: its write showed but was never committed, and a later write that compared against the signal was skipped (#5233). An action that yielded could also commit its first write during the `yield`.
