---
"@solidjs/signals": patch
---

Gate the post-recompute child-companion walk on companions actually existing below the firewall (#3038). A store computed carries one firewall child per materialized leaf, so the unconditional walk made every update cost O(all leaves ever read) — 17.6ms/mousemove in the reported flow-graph app. Companion creation registers the child on its firewall's companion set and the post-recompute snap iterates that set — O(companions asked for) for every app, and stores with no leaf-level isPending()/latest() reads never allocate it or pay anything.
