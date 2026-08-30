---
"@solidjs/web": minor
---

Single-flight always folds the keyed envelope — the raw legacy payload shape is gone with the other RC shims. The unnamed registration's slice rides under its reserved id "true" like any named source, so `{ value, data }` has one shape, not two; the client always delivers `data[source]` to each consumer. The unrecognized-opt-in courtesy (arbitrary truthy header values reaching the unnamed hook) is also removed: only exact source ids run collection.
