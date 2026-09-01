---
"@solidjs/web": patch
---

The patch-mode list driver's rebuild check now uses SameValueZero, agreeing with the matcher's Map-based equality: a moved NaN row keeps its DOM node (parity with classic's diff, which gets this for free from Map semantics).
