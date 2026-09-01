---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Third re-audit hardening of the patch channel: same-batch coalescing updates the queued entry in place (latest `next` wins — adoption replaces the captured object, so dropping later emissions applied stale state) and the drain clears the channel stamps (no batch retention on quiet records); the adoption remainder window builds from the misalignment point so prefix-consumed rows are never re-offered to duplicate keys; optimistic tentative matching gains SameValueZero + occurrence-aware parity with the plain channel; a failed row-ops application forces an identity resync on the next update (the store committed the failed topology while DOM kept the old one — positional ops would mis-index) and suppresses slot ticks until the baseline is restored; a throwing row factory also severs its own partial registrations.
