---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Add an experimental TSRX syntax frontend to both compilers. `.tsrx` sources (routed by filename with the new `syntax: "auto" | "jsx" | "tsrx"` option) desugar `@if`/`@else`, `@for … @empty`, `@switch`/`@case`, `@try`/`@catch`/`@pending`, `@{}` statement containers, and lazy destructuring (`&{}`/`&[]`) into the shared Solid JSX lowering, producing byte-identical output from both compilers. The Babel plugin loads the optional `@tsrx/core` peer dependency lazily; the native compiler ships the frontend behind the default-on `tsrx` cargo feature (statement containers in expression position are rejected with a structured diagnostic pending upstream oxc-tsrx support).
