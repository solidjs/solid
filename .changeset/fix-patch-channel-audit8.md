---
"@solidjs/signals": patch
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/universal": patch
---

Re-audit-8 hardening: manifest deep-path probing at admission (nested
getters present at registration take the tracked fallback), committed-view
initial applies, structural operations bind their captured records via
patchProxyFor, tentative reconciles bubble ancestors at lane timing with
settle-held twins, generation-stamped drains eliminate duplicate applies to
freshly mounted consumers, forced ancestor bubbles coalesce per batch,
non-integer numeric keys are statically patch-ineligible in both compilers,
and createRenderer exports/documents rowProof plus an untracked commit
phase for its patchDriver.
