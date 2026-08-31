---
"@solidjs/signals": patch
---

Round-10.10 audit fixes: demotion envelope computes read each step exactly once (deep roots no longer double-read, so unstable getters track the value they commit) and descend through functions (accessor carriers); iterable manifests preserve symbol keys instead of stringifying them; the channel WIDE_WRITE twin moved into the attribution engine (same thresholds, memo, and metadata as graph wide-writes); ancestor bubble stamps carry the originating child as their cause; and structural row-ops/slot channels fire the same registration fan-out milestones.
