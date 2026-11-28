---
"@solidjs/signals": patch
---

A `<Show>` over a `latest()`-derived loading flag no longer stays empty when its branch re-runs while a render effect in the earlier branch still waits on a `<For>` list (#5211). That render effect was on the frame the branch's re-run replaced, and the verdict lane waited on it while it waited for the lane's reveal.
