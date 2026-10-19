---
"solid-js": patch
---

`CHEATSHEET.md` (and the `solid-2.0-cheatsheet` skill built from it) no longer recommends module-scope state for app-wide state (#4141). It now matches the `createContext` JSDoc and the 2.0 docs: create state in a Provider, which owns it per request on the server, and reserve module scope for constants.
