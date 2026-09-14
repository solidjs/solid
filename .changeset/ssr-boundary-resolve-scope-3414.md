---
"solid-js": patch
---

Fix a server-rendered `<Errored>` fallback hydrating dead (#3414). When the boundary's children threw synchronously on the server and the fallback was a zero-arg thunk (`fallback={() => <Fallback />}`), the thunk was handed back unresolved and unwrapped by the enclosing boundary — the client does that inside the boundary's flatten computed, the server did it inline under the boundary owner — so the fallback's hydration keys disagreed, its root element failed to claim the server node, and its event handlers and effects never attached. The server `Errored` and `Loading` boundaries now resolve their children's result in a virtual id scope mirroring the client's second computed; the error record stays at the boundary id.
