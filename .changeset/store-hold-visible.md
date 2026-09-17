---
"@solidjs/signals": patch
---

The store's backing-level visibility (which container — committed or staged — a reader of a held store sees, for property reads, `in`, `Object.keys` and descriptors) is one `holdVisible` on the core's shared predicates for both hold kinds (a setter's fold, an adoption under a transaction), replacing six store-local helpers. No behavior change; −313 B minified in the store.
