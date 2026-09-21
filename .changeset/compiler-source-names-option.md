---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"solid-js": patch
"@solidjs/web": patch
---

Rename the compilers' `componentNames` option to `sourceNames`, now `boolean | { components?: boolean }`. `sourceNames: true` (or `{ components: true }`) is what `componentNames: true` was — the tag as written in source as `createComponent`'s third argument, on DOM and SSR output. The option is now the home for every kind of source name the compilers can carry into output for the dev and observe runtimes to label the reactive graph with (binding effects and primitives follow); the object form picks kinds. `@solidjs/compiler` rejects `componentNames` as an unknown option, so a stale `@solidjs/vite-plugin` fails loudly rather than compiling without labels.
