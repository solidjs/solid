---
"@solidjs/signals": patch
"solid-js": patch
---

`from(source)` turns a callback subscription (`(next, error, complete) => unsubscribe`), an Observable (`subscribe(observer)`, with `Symbol.observable` / `"@@observable"` interop) or an AsyncIterable into an AsyncIterable for a computation: `createMemo(() => from(source))`. It keeps only the latest value, a value emitted during `subscribe` lands with no loading frame, and errors reach the nearest error boundary. The source closes when the computation re-runs or its owner is disposed, without waiting for the replacement's first value, even when `from` is iterated with `for await` inside an async generator memo: an internal supersede hook chains onto the node's iterator teardown slot (#3122). On the server, `from` yields the source's first value and then unsubscribes; `ssrSource: "hybrid"` continues the stream on the client.
