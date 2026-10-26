---
"@solidjs/universal": patch
---

A dynamic child region of a universal-renderer element that renders an empty fragment (for example a `<Show>` with `fallback={<></>}`) no longer loses its place among its siblings: the region now keeps its sentinel while empty, so the content that later replaces it is inserted where the region sits instead of being appended after the following siblings (#4274).
