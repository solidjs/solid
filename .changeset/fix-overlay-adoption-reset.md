---
"@solidjs/signals": patch
---

Reset overlay pending-backing state (`ovl`, `del`, accessor-scan verdict) when a setter-return replacement adopts a new backing: stale state could crash snapshot after a write+replace draft, carry deletion metadata onto the adoptee, or admit an accessor-bearing adoptee to the overlay path where writes shadow live setters. Adds targeted overlay semantics regression tests.
