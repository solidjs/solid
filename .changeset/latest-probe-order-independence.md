---
"@solidjs/signals": patch
---

Fix latest()-mode isPending probes answering differently depending on read order (#3104). Two probe-mode leaks in the verdict layer: latestRead's mid-tick shadow pull recomputed a stale shadow with the probe still live (collecting the parent and flipping the verdict to the held-write answer only when nothing had pulled the shadow earlier in the tick), and the probe's companion-verdict reads ran with an outer latest() window still active, building a shadow of the pending signal itself that later halted dev with the owned-scope write guard when a flush recompute wrote it.
