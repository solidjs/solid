---
"@solidjs/signals": patch
---

An async memo's first answer that resolves in the same tick as a plain write re-asking it is answered, then re-asked (D-22, F-9): `isPending` of it is `true` while the new question flies, and an identity memo or derived store over it reads the answer through `latest` like the memo itself.
