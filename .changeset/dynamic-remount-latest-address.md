---
"@solidjs/web": patch
---

Fix a remounted `dynamic` server-component site rendering the first resolution's content instead of the latest call's (the away/back navigation regression on the identity split). `dynamic`'s kept-resolution path returns `prev` — a binding whose `.address` is frozen at the first resolution — and delivers fresh addresses only to currently-mounted sites, so a site that unmounts and later remounts initialized its address accessor from the stale binding: the fresh mount bound the first call's resident store (the SSR payload, in the document-adoption shape) while the remount's refetched response warmed a store nothing was bound to. The latest resolved address is now tracked at the `dynamic()` level and new mounts initialize from it; live-delivery into mounted sites is unchanged.
