---
"@solidjs/signals": patch
"solid-js": patch
---

`from(source)` turns a callback subscription (`(next, error, complete) => unsubscribe`), an Observable (`subscribe(observer)`, with `Symbol.observable` / `"@@observable"` interop) or an AsyncIterable into an AsyncIterable for a computation: `createMemo(() => from(source))`. A subscription keeps only the latest value, and a value emitted during `subscribe` lands with no loading frame; an AsyncIterable streams through. Errors reach the nearest error boundary. The source closes when the computation re-runs or its owner is disposed, without waiting for the replacement's first value, including a `for await` over `from` that starts before an async generator memo's first `await`: an internal supersede hook chains onto the node's iterator teardown slot (#3122). On the server, `from` streams like the client, and `ssrSource` decides how much of it the server consumes. Subscriptions and Observables carry the live-source brand, so the server serializes their first value and unsubscribes, and the hydrated client subscribes again. The server releases the source on `return()` or owner disposal.
