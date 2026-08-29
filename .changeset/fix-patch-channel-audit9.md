---
"@solidjs/signals": patch
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/universal": patch
---

Re-audit-9 hardening: committed-visible skip semantics (mounts are never
stranded stale; held/tentative payloads always deliver), held-view and
optimistic-view initial applies, write-free manifest-read effect fallback
(web + universal), tentative reconciles emit their view on the record's own
channel with immediate lane-timed accessor demotion, per-queue forced-stamp
clearing with merge repair, isWrappable bind guards, server-entry
patchDriver/rowProof exports, function-intermediate deep probes,
safe-integer-only manifest keys, and unchanged reconciles no longer force
ancestor re-applies.
