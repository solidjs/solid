---
"@solidjs/web": patch
---

`live`: an iteration stamped with the value it resumes from (hydration's takeover of a server-rendered value) now yields that value first, before it connects. The server's digest-equal skip means the wire may carry no first emission, and the node that re-ran its compute for the takeover had no other way to land — left pending, it held every write of the tick that released it (the identity minted at `onSettled`, for one) until the source changed. Landing the adopted value is equality-quiet for a memo and a no-op reconcile for a projection; `Last-Event-ID` and the wire skip are unchanged.
