---
"@solidjs/web": patch
---

A server component factory mounted more than once keeps an independent hydrated client slot at each site. The first site still uses the function id; each later site gets its own frame scope so hydration keys, slot records, and adoption do not collide.
