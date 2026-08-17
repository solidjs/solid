---
"solid-js": patch
---

Re-subscribe `enableExternalSource` computations to the ordinary source after a transition. A computation created while a transition was running only tracked the transition-scoped source; once that source was disposed, later external updates were lost.
