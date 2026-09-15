---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

TSRX: `@for … index/key` items and `@catch` errors pass through to `For` / `Errored` as the accessors Solid hands out; the compilers no longer rewrite reads of those bindings into calls (#3474). Author `item()`, `i()` (under a custom key), and `err()` exactly as in JSX. A destructuring pattern in one of those positions is rejected with a diagnostic, since there is nothing to destructure — the default keyed `@for` item is still a raw value and still destructures. `projectTsrxForTypecheck` emits the same `(item, i) =>` / `(err, reset) =>` arrows `@tsrx/solid` does, so the two typecheck projections now agree.
