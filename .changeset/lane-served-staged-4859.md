---
"@solidjs/signals": patch
---

Lane work that was served a flight's committed value and then reads a write of the same flush waits on the flight before the flush has a transaction too, so a `<Loading on>` over a memo reading a guess shows its fallback for a new key instead of the old answer under it (#4859).
