---
"@solidjs/compiler": patch
"@solidjs/babel-plugin-jsx": patch
---

Drop leftover DOM Expressions loader fallbacks and reframe the compiler and Babel plugin as Solid 2.0 packages. Node `transform()` now defaults `moduleName` to `@solidjs/web` and `builtIns` to the Solid control-flow set, matching `@solidjs/babel-plugin-jsx`. SSR leaves a sole component child unescaped (it is a value; the callee's insert sites escape) and only HTML-escapes mixed/fragment children and element holes.
