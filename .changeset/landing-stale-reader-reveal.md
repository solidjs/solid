---
"@solidjs/signals": patch
---

A transition landing no longer shows its held writes before a render effect it re-derives on the landed world discovers a new pending flight: the landing's effect runs wait for that re-derivation, and park with it until the flight lands (#4071).
