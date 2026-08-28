---
"@solidjs/signals": minor
"@solidjs/web": minor
---

Shallow store lists through the compiled driver: slot patches graduate from
prototype to channel semantics (key-aligned value-replaced slots only —
structure rides row ops — queued at effect phase under the registration
owner), and the list driver collects a shallow row's compiled bodies at bind
(rows are raw; nothing to register on) and dispatches them from the array's
slot channel, rebasing indices with structural ops. Adds storeIsShallow;
kind-changing subject swaps (shallow <-> deep) hand off to classic.
