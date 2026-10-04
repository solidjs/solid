---
"@solidjs/compiler": patch
---

Fix native TSRX compilation of parenthesized keys, iterables, and conditions, including annotated `@for` loops used directly in a component body. Map comments back to the authored source to prevent invalid JavaScript and Unicode panics when source maps are enabled.
