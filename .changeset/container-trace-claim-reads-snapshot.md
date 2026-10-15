---
"solid-js": patch
---

A fill that claims adopted markup reads the state the server rendered it from (frames-rulings 3.6 (iii), "the consumer parks" — S1's third commit ported onto `next` without its `claiming` hint).

- `materializeContainerTrace` parks a replayed backlog beyond the snapshot until hydration ends (`onHydrationEnd`; the next microtask when no hydration is in progress) and then applies it as one ordinary update. A container trace is materialized at a fill's arg-read; when that fill claims server markup — the document's pass, a frame's deferred claim under its hold, a claim at a fragment's reveal after hydration-done — the snapshot is what the markup was rendered from, the claim trusts the markup (a text hole is never rewritten during a claim), and a store already past the markup left the DOM diverged for good. Parked, the claim reads the snapshot and the backlog lands after it, so the DOM catches up outside hydration. The release order is the one 3.2 pins: the claim, the frame's hold release, done, then the backlog. A fresh mount pays one beat for not being told apart: its backlog lands a microtask after its snapshot, before any paint. A failure in the backlog applies in order, after the parked patches.
- The materializer creates its projection under a DETACHED root. Rooted under the reading owner — during hydration an id-carrying one — a trace revived at t=0 consumed one child id per trace while one revived by a late claim consumed none, and a keyed sibling after the frame hydrated under different keys in the two runs.
