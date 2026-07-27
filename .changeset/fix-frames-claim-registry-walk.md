---
"@solidjs/web": patch
---

Frames: gather hydration-claim registries without descending into nested regions

`claimRender` built each occurrence's registry with `querySelectorAll("*[_hk]")` over its existing nodes, which descends into nested `<dx-frame>` regions — content that belongs to nested occurrences running their own claims. On a deeply nested adopted tree (an HN comment thread) every level re-collected its entire subtree, making registry gathering O(nodes × depth). The registry is now gathered by a walk that treats region elements as opaque, so the total work across all claims is linear in the tree.
