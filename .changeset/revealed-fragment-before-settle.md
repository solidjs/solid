---
"solid-js": patch
---

Hydration no longer hydrates a streamed `<Loading>` fallback when the fragment was already revealed but its `_fr` record hasn't settled yet (an async entry running between the two scripts). The boundary renders nothing and adopts the revealed content once the record settles (#4074).
