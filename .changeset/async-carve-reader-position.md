---
"@solidjs/signals": patch
---

Async holds follow the reader, and are shorter:

- A first load read by a render effect outside a `<Loading>` makes the change that mounted it wait (the async answer of a memo created under a hold lands with that hold); a `<Loading>` that has not shown content catches it instead and shows its fallback.
- Creating a memo no longer pulls the whole tick into a hold: the render effect that reads it decides. A memo nobody renders holds nothing.
- `isPending` or `latest` alone never holds a change; a plain read beside them still does.
- `isPending` of a memo born held joins the hold with its reader instead of reporting a verdict.
- An optimistic store row's server echo is judged as reconcile would (key order free, a self-referencing row is a correction) instead of by `JSON.stringify`.
- An errored reader is not re-run when a transaction lands, so an errored derived store is not refetched by a row that also reads `isPending` (#3945, #3962).
- `refresh()`'s promise reads the truth beneath a guess the same way `until()` does (#3895).
- An optimistic **signal** (`createOptimistic`) judges its source's answer with its own `equals`, as signals do: a server's new array or object is a correction unless `equals` says it is the same. (`next` compared every optimistic answer with `JSON.stringify`.) Store rows follow reconcile: equal `Date` objects, or `{ t: undefined }` against a missing key, are corrections.
