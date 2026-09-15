---
"@solidjs/signals": patch
---

`latest(() => store.key)` on a derived store (projection) that has not yet resolved threw for tracked and untracked reads but returned the **seed** through `latest()`: `read()` routes a `latest()` read to the companion before its firewall/status logic, and the leaf's own `_value` is the seed. `latest()` now judges "uninitialized" on the leaf's owner — the projection's firewall — and throws `NotReadyError` like every other read (A25: the seed is a draft, never a value; A7).
