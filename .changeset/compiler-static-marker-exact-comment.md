---
"@solidjs/compiler": patch
---

Only treat an expression's first leading comment as the static marker when its text is exactly the marker, as the Babel plugin does, so comments that merely mention it no longer freeze the binding.
