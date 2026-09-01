---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Fix hydration ids drifting after a reactive lone spread (#3105). A lone spread now passes its accessor straight to `spread()` on the client — no `mergeProps`, no memo, no hydration id — matching the server's existing pass-through fast path. The runtime resolves a function props source inside its own tracking scopes.
