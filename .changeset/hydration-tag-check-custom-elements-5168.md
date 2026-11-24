---
"@solidjs/web": patch
---

The dev-mode hydration tag check reads the template's full tag name, so a correctly claimed custom element (a tag with a hyphen) no longer warns `Hydration tag mismatch`.
