---
"@solidjs/signals": patch
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Patch-channel contract hardening from the stage-2 re-audit: ordinary `patchDriver` registrations unbind with their owner (entries no longer leak past unmount); merged transitions move their held-patch stash so no patch strands; the optimistic drain shares the normal drain's per-entry error isolation and boundary routing; accessor-bearing records are excluded at admission (scan-before-trust) and records that acquire accessors demote their patches to tracked effect fallbacks; writable projection arrays emit setter row ops at their fold-commit visibility moment; row-ops/slot registrations resolve chained backings to the ultimate owner; duplicate keys match occurrence-aware instead of first-wins; the production dev-token typo (`_DX_DEV_`) is fixed; `patchDriver: true` normalizes identically in Babel and the native loader, the option is typed in `TransformOptions`, and a `dom-patch` parity tier ratchets patch-mode output across both compilers (currently byte-identical on all fixtures).
