---
"@solidjs/compiler": patch
---

A module-level `"use server"` module that exports something other than a server function is now a compile error instead of producing a client build with the export missing.

- Covers re-exports, `export *`, class and enum exports, destructured exports, and exports declared without an initializer.
- The message names the export, its position, and what to do instead.
- Type-only and `declare` exports are erased and stay allowed.
