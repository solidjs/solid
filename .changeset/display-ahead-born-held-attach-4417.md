---
"@solidjs/signals": patch
---

A display-ahead `<Show when={latest(x)}>` no longer attaches its branch with an empty hole while a plain `x()` binding inside it is born held (#4417, F-2, D-27). The pass that mounts a render effect a transaction holds from birth, under a verdict lane and caught by no boundary, is the hold's: it leaves the verdict lane and stages with the transaction, so the fallback (or the previous content) stays until the landing and the branch mounts once.
