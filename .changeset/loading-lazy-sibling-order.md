---
"@solidjs/web": patch
---

Hydrating a `<Loading>` whose `lazy()` module lands after hydration starts no longer moves its server-rendered nodes when the boundary has a sibling in the same fragment (#4049). A sibling before the boundary used to swap the boundary's static and lazy children (A/C/B instead of A/B/C), and a sibling after it detached and re-attached the boundary's content, restarting CSS animations and blurring a focused input. The late claim now leaves server nodes in place when they already sit in the region, in order, around the nodes the insert was tracking.
