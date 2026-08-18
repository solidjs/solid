---
"solid-js": patch
---

Serialize a boundary's lazy-module map (`<id>_assets`) as a snapshot (`{ ...modules }`) instead of the live object in `commitBoundaryState`. The map can gain entries after the boundary's first serialization (a nested lazy registering post-flush), and the streaming serializer's reference dedup would re-emit the same mutated object as a back-reference to the stale first snapshot, dropping the later entries and halting lazy hydration on the client. Defense-in-depth alongside the same fix in dom-expressions' `serializeFragmentAssets`; server-only, no client bundle impact.
