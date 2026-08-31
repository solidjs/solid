---
"@solidjs/signals": patch
---

Round-10.9 audit fixes (demotion fallback lifecycle): demoted bodies with manifests compute by reading their OWN declared envelope (per entry, never the channel union) so NaN/unstable-getter compares can't fire DOM writes inside tracked computations; a failed compute skips its commit instead of force-applying after a swallowed error; re-drive roots are id-transparent (classic fallback owner/hydration depth); and the manifest-less full-scan poison (akAll) is ref-counted, releasing with its last consumer.
