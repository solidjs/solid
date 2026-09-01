---
"@solidjs/signals": patch
---

Fix a one-frame `isPending === true` pulse leaking to direct render effects when a quiet `refresh()` landing is transition-held (#3178). The quiet re-ask classification now survives the landing until the hold commits (the reveal), mirroring the #2990 loading-window treatment, so companion synchronization never classifies the held old value as pending.
