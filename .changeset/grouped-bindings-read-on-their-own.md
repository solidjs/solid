---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

A template's grouped attribute effect reads each binding on its own, so a binding whose first load is in flight no longer hides a later binding's error (grouping never changes the result, #4284).
