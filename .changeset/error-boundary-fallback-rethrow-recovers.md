---
"@solidjs/signals": patch
---

An error boundary that caught an error rethrown from an inner boundary's fallback now recovers when the inner content does: switching the inner boundary back to its content disposes the fallback that threw, and the outer boundary now drops that error and shows its content again in the same flush, instead of keeping its fallback until some later error re-rendered it (#4270).
