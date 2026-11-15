---
"@solidjs/web": patch
---

fix(web): a server function mutation with nothing folded and no metadata still reaches every flight consumer, so a router revalidates after a direct call or a core `action` (#4883)
