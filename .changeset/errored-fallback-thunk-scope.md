---
"solid-js": patch
---

`<Errored>` builds a function-valued `fallback` inside its own scope, whatever its arity — like `<Show>` resolving a function child. A zero-arity thunk (`fallback={() => <F />}`, type-reachable since `() => X` is assignable to `(err, reset) => X`) used to be handed back unresolved for the consuming hole to build on the enclosing owner's counter, which permuted hydration keys whenever a scoped hole followed the boundary in the same element (surfaced by #3620). Zero-arity and two-arity fallbacks now allocate identically on server and client; reset, error narrowing, fallback reactivity and the dev `console.error` for a fallback that cannot see the error are unchanged. A rest-parameter fallback (`(...args) => …`, `length` 0) now receives `err` and `reset` too.
