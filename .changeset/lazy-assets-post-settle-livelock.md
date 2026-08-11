---
"solid-js": patch
---

Fix the dev-streaming SSR livelock behind beta.33's hang/OOM on lazy routes
under layouts. With an async asset resolver (the dev-server manifest shape),
`lazy()` armed a fresh `assetsPending` gate on every component re-creation
even after its module and assets had settled: the per-request `_lazyAssets`
cache memoized the resolver's PROMISE forever (each new wrap chained `.then`
off an already-resolved promise — pending at the render memo's compute,
settled one microtask later), and the moduleUrl-less path chained `p.then`
per creation with the same geometry. Any pattern that re-creates the lazy
component across suspended render passes — a route layout's outlet, or any
recomputing parent — then threw `NotReadyError` on a gate that resolved
immediately after, and the boundary resume loop re-rendered forever on the
microtask queue: timers starved, hydration ids and serializer state grew
without bound, and the dev server died on V8 heap exhaustion (~30s per
request). The 0.50.0-next.41 retry-wrapper flattening exposed this: the old
per-pass wrapper stacking happened to bound the loop by side effect.
Production manifests answer synchronously and never enter the async branch,
so only dev-mode streaming SSR was affected. Both gates now settle
structurally: the cache entry upgrades to the resolved value when the
resolver settles, and a re-creation after the module import settled reads
`$$moduleUrl` synchronously instead of chaining another promise hop. This
should ship as beta.34 promptly — beta.33's dev streaming SSR is unusable
for lazy routes under layouts (the solid-router fullstack shape).
