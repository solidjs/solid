---
"@solidjs/signals": patch
---

Three lane-engine arms that no suite, pin or generator case has ever executed are removed: `heldBy` (the "frame parked by one pass alone" exemption at the seam, #4439 — it never returned true, not even in the suite of the commit that introduced it), the `bornHeldOpen` tail of `attachWaits` (#4574 — the mount stamp of S-46/S-58 seats a born-held mount before anything inserts it, and lane work never joins a hold, D-37, so the walk never found a node), and `under` (nested lanes cannot exist: a lane is never the flush's transaction, D-37, so no guess is ever parented to one). The lane link merge (`linkLanes`, A15 for lanes) stays: it is reachable — four in-flight optimistic actions read as two pairs, then a later reader across the pairs — and now has a pin. No behavior change; −260 B brotli / −900 B minified on the `isPending`/`latest` chunk.
