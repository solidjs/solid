---
"@solidjs/compiler": patch
"@solidjs/signals": patch
---

`transformSourceNames`: the pass behind the Vite plugin's `sourceNames.primitives` option (a `@solidjs/vite-plugin` option, not a compiler `transform()` option — the compiler exposes it as this standalone function). Reactive primitives (`createSignal`, `createMemo`, `createOptimistic`, `createStore`, `createOptimisticStore`, `createProjection`) resolving to a `solid-js` / `@solidjs/signals` import are named after the identifier they are declared as — array pattern, binding, property key, or class field — prefixed with the enclosing non-component function (`createCounter.value`), never overriding an explicit `name`. Plain JavaScript in and out, so it runs on `.ts`/`.js` modules too.

Stores honour `name`: `createStore(value, { name: "todos" })` labels its property nodes `todos.title` in attribution output instead of `store.title`; derived and optimistic stores name their property nodes alongside the projection node.
