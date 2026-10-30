---
"@solidjs/signals": patch
---

A memo between a render effect and an async memo in flight is born held with the mount that first reads it (#4504, D-2, D-22, D-27). With an input that reads `latest()`/`isPending()`, the memo carried that verdict posture by what it read (D-25), and its pass in a plain mount mid-flight stamped the posture from the read of the pending async memo even though the read threw: at the landing the memo re-ran as a verdict reader and was served the async memo's committed value, so the held reader showed the old answer at the landing and the new one only at the commit (`r:2`, then `r:4`). A read of a pending node now hands on no posture to a pass that is not a verdict reader already: the reader waits for the re-ask's answer and shows it once (`r:4`), as when it reads the async memo directly. A memo that was already a verdict reader on screen keeps its posture.
