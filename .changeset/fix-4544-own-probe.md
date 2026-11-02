---
"@solidjs/signals": patch
---

A memo holding a transition's staging keeps that staging when its own pass probes, so the branch the hold opened does not wait on the signed-out world (#4544).
