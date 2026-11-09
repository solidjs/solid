---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Shrink the compiled and hand-written floors: the dependent walks, dependency clearing, status writes, effect-run queueing, flatten's thunk walk and the delegated-event parent hop share their code (no behavior change).
