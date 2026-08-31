---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Patch-channel size pass: the drain-side read-recording proxy is deleted — manifest-less registrations poison the key union (`akAll`) and adoption/delivery probes full-scan instead (compiled output always ships manifests, so only hand-written callers pay wider probes); `applyEntries` collapses to its single delivery mode; error-routing and deferred-halt shapes consolidate into shared helpers. Value tier 16.22 → 16.05 kB, list tier 18.79 → 18.60 kB (brotli), ratchets tightened.
