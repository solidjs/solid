---
"@solidjs/web": patch
"solid-js": patch
---

Fix `hydrate()` halting with `TypeError: Cannot read properties of null (reading '_config')` when a `useHead({ tag: "link", props: { rel: "stylesheet", href } })` sheet is still loading as hydration reaches it (the default with an async entry script), including on a late streamed boundary resume. The `waitAsset` gate memo is created without an owner, and the hydrating `createMemo` tried to peek a hydration id from that null owner; the gate is now `transparent`, so hydration never sees it. `useHead` also no longer gates stylesheets while hydrating: that content is already visible, and a pending read inside a boundary's claim window made the boundary render fresh DOM beside the server's.

A streamed `<Loading>` boundary whose fragment swap the server holds on a stylesheet (`$dfs`) now resumes when the swap lands, not when its `_fr` record settles. Resuming on the settle claimed against a document that did not have the content yet, then the delayed swap inserted a second copy.
