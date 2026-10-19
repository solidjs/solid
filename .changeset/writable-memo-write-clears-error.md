---
"@solidjs/signals": patch
---

A write to a writable memo clears an error its derivation left behind (#4110). Clearing `STATUS_ERROR` only happened on a recompute or an async settle, and a direct write does neither, so a memo that had thrown kept throwing the stale error to every later reader: effects stayed on their error arm, error boundaries never recovered, and the written value sat committed underneath a node that still reported an error. A write equal to the last good value was dropped entirely by the equality gate. Writing to such a memo now recovers it, which is what "a write lands at once and never re-runs `fn` on its own" already promised.
