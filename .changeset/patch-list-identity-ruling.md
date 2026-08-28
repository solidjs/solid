---
"solid-js": patch
"@solidjs/web": patch
---

Patch-mode lists now implement the identity semantics the view declares instead of the reconcile key's. Deep lists are unaffected (adoption preserves proxy identity, so key ops and reference semantics coincide). Shallow reference-keyed lists rebuild rows whose records were replaced — matching classic `mapArray` exactly, where the driver previously patched them in place (a default-on compiler mode must never change observable DOM identity). `For` forwards its `keyed` prop on the list metadata; explicit `keyed={fn}` lists decline the driver until the accessor-row binding contract lands.
