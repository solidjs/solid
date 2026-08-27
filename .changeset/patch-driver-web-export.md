---
"@solidjs/web": patch
---

Fix patchDriver's runtime references (patchableRaw/registerPatch were in a
re-export block, not module scope) and surface patchDriver from the web entry
for patch-mode compiled templates
