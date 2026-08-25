---
"solid-js": patch
"@solidjs/web": patch
---

Recover from `REACTIVITY_HALTED` in dev workflows. A halt is global to the runtime instance, so one uncaught error used to permanently brick HMR (hot swaps are signal writes, which a halted scheduler drops) and playground-style embedders (a fresh `render()` never mounts because its queued effects can never flush) until a full page reload. Now the refresh runtime revives scheduling before patching a hot update, and `render()` resets the halt in dev before mounting. `resetErrorHalt` is re-exported from `solid-js` (no-op on the server) so dev tooling can do the same. Production behavior is unchanged: a halt remains a hard crash.
