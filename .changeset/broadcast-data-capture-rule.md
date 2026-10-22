---
"@solidjs/compiler": patch
---

The `broadcast()` capture rule now covers data answers too. A returned value that is not a component (an async iterable, usually a call that makes one) may read the server function's parameters and module scope, never its outer body's locals: every later caller gets the first caller's stream, so `const user = await getUser(); return watch(user.id)` is a compile error. Of a returned `respond(value, init)` only `value` is checked, since each caller's response carries its own headers and status. A generator (`async function*`) is not checked: calling it runs none of its body, so all of it is shared.
