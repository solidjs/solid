---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Patch-channel round-6 hardening: prod-sound getter demotion via accessed-key
recording with bounded adoption probes (replaces the dev-only check),
same-channel transition-merge coalescing (one live-resolving apply per record
when merged transactions both queued it), structural row/slot queue entries
now respect unbinds and error routing like value patches, fixed-window
dispatch for the single-consumer alias, initial list construction severs
registrations and removes claimed DOM on throw (client + hydration), and
failed-apply identity resync now triggers actively on slot ticks.
