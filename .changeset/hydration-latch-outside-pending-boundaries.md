---
"solid-js": patch
---

Fix: after the root hydration pass, a node that adopted its serialized server value and sits outside every still-pending streamed boundary now updates on a client write (a navigation or a cache write while a slow boundary streams in) instead of re-adopting its server value until the whole page finished hydrating. The wait contradicted the snapshot design: snapshots exist so everything outside an incomplete boundary hydrates and moves on, while each pending boundary later hydrates against its server snapshot and then catches up to the client's newer state. Streamed boundary owners are now marked pending until they resume or are disposed; nodes under a pending boundary, and nodes in the claim in progress (the root pass, or the resuming boundary's own subtree), keep the latch as before.
