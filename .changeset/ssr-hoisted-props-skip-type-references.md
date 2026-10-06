---
"@solidjs/compiler": patch
---

Fix native SSR compilation of a hoisted props body that mentions a type parameter or type only in a type position, such as an arrow parameter annotation, `as`, `satisfies` or a call's type arguments. The type-only name was captured as a runtime value, emitting a reference to a binding that does not exist (#3828).
