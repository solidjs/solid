---
"@solidjs/signals": patch
---

fix(signals): a projection leaf released by the unobserved sweep also leaves its firewall's companion set, so an obsolete value read only through `latest()`/`isPending()` becomes collectable once every reader is disposed (#3503)
