---
"@solidjs/signals": patch
---

An action called from a cleanup (`onCleanup` or an effect's returned cleanup) that runs while a transition lands no longer leaves the flush pointing at its landed transaction. Before, the next action merged into it: its write showed but was never committed, and a later write that compared against the signal was skipped (#5233).
