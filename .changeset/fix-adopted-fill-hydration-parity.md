---
"solid-js": patch
"@solidjs/web": patch
---

Fix the document-face slot-fill hydration misses (the chat welcome/status shape): adopted fills now claim the settled server markup instead of key-missing and re-rendering. Three defects, one per layer. `@solidjs/web`: the lazy async-read memos in `slotArgsProxy` minted a hydration child id the document producer never allocated (shifting every subsequent key in the occurrence namespace) and treated record-revived settled promises as pending — they are now `transparent` and fast-adopt the serializer's settle stamps. `solid-js` boundary: a SUPERSEDED fragment (settled `_fr` whose markup never shipped because an outer boundary converged first) was hydrated "straight through", claiming keys the document never emitted — the boundary now detects the unswapped placeholder, hydrates the showing fallback, and resumes with fresh client DOM. `solid-js` containers: `materializeContainerTrace` gains a synchronous path for the raw-stream trace wire shape, so a snapshot the document already delivered reads as ready DURING the synchronous claim walk instead of suspending a settled boundary into a phantom fallback.
