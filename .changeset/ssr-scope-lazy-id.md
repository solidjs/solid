---
"solid-js": patch
---

Server `scope` reserves the hydration slot without formatting an id string until a child needs one; recovers most of the renderToString cost added by #3599.
