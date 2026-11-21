---
"@solidjs/compiler": patch
---

SSR output, and DOM output for class-field arrows, no longer inline an outer `const` where a function or arrow parameter of the same name shadows it.
