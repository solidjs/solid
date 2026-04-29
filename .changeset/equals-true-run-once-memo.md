---
"solid-js": minor
---

Adds `equals: true` to the signal/memo options, the symmetric counterpart of
`equals: false`. Where `equals: false` always notifies subscribers, `equals: true`
never does — the cached value is frozen at the first computed result and
downstream consumers see a constant. Backed by a new exported helper
`isAlwaysEqual` (mirror of `isEqual`).

The compute function still runs when its dependencies change; the new value is
just discarded by the equality check, so subscribers and reads keep returning
the original. For writable memos, setter writes are likewise dropped — the
"always equal" guarantee applies uniformly.
