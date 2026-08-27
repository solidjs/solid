---
"@solidjs/web": patch
---

Export the patchableRaw/registerPatch rxcore seams from the web core so the dom-expressions runtime's own patchDriver links. The public patchDriver export is unchanged (the web core's richer driver, with the shallow-row collector branch, still shadows the runtime's).
