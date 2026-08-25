---
"@solidjs/compiler": patch
---

Module-level "use server" exports must be precisely the server functions: wrapping an export in a call expression (`export const x = GET(async () => ...)`) is now a compile error directing to the function-level directive. Replaces the short-lived wrapper-transplant behavior, which hoisted server-module code into the client build and never applied to HTTP dispatch anyway. Plain aliasing and separate declaration/export remain supported.
