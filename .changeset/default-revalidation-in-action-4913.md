---
"@solidjs/web": patch
"@solidjs/signals": patch
"solid-js": patch
---

fix(web): only a server function call made inside an action gets the default revalidation (#4913)

A non-GET call made while an action body runs (a core `action`, or a router `formAction`) is a mutation: it asks for single-flight collection, and its response reaches the flight consumers even with nothing folded, so a router revalidates every query. A call made anywhere else, such as a query's fetcher, no longer does, which stops the refetch loop that started in rc.22. Explicit `X-Revalidate` keys and redirects still reach the consumers wherever the call was made.
