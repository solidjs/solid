---
"@solidjs/signals": patch
"solid-js": patch
---

Flatten one async level for computations: a promise that resolves to an AsyncIterable is now consumed as the stream itself rather than settling on the iterable object. `createMemo(() => serverFn())` works directly when the async stub resolves to a stream — no `yield* await` wrapper needed. Client core (`handleAsync`) pumps the resolved stream under the original flight's identity with iterator close registered on the flight's disposal; SSR mirrors with first-yield settle, first-value lock, a tapped stream on the serialized promise channel (which client hydration adopts and flattens again), hybrid first-value-and-close, and the frame binding-ledger pump.
