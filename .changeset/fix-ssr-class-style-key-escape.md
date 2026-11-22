---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

SSR escapes string keys of inline `class` and `style` objects for the attribute, the way the runtime helpers do, so a key such as `'before:content-["*"]'` no longer breaks the attribute and a key with a backslash, backtick or `${` compiles to the same class name.
