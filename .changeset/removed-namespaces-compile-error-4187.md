---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

The removed Solid 1.x attribute forms are now compile errors on native elements in the `dom` and `ssr` generates (#4187). `on:`, `oncapture:`, `attr:`, `bool:`, `use:` and `classList` used to compile silently into literal attributes (`<div use:tip="() => {}">`, `classlist="[object Object]"`). Both compilers now reject them with the same message, which names the 2.0 replacement: a camelCase handler or a `ref` callback for `on:`, a plain attribute for `attr:`, a boolean value for `bool:`, a `ref` directive factory for `use:`, and an object or array `class` for `classList`. Components, the universal generate, `prop:` and the XML namespaces (`xlink:`, `xml:`, `xmlns:`) are unaffected. The check runs only at compile time and adds no runtime code.
