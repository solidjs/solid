---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Round-10 audit fixes for node-delivery patch channels: ancestor bubbling moved into the bump primitive (post-await landings, optimistic nested writes, and channel-less seams all reach ancestor consumers), eager child adoptions path-copy the ancestor chain so late mounts read current raws, dispatch defers entries whose owner queue is holding (Loading/reveal parity), demotion fanout is per-entry isolated, subject swaps build from the optimistic visible array with family-identity retention, and the deferred-demotion latch dies with its consumers.
