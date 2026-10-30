---
"solid-js": patch
---

Server: when an `<Errored>` renders its fallback for a `<Loading>` that failed after the shell, and a hole in that fallback rejects while the server waits for it, the rejection now goes to the next boundary up, as it does when a fallback throws synchronously. Inside a pending outer `<Loading>`, that outer fragment fails; under an outer `<Errored>` whose whole content is that position, the outer fallback is drawn there and the client adopts it. Before, the region streamed blank and the hydrating client halted (#4316). A synchronous throw in that fallback no longer writes an error record for an outer `<Errored>` without sending its fallback.

The server's wait for that fallback now stops after the same pass budget as the `<Loading>` resume loop and then streams what it has. It also stops as soon as the render is torn down, for example when the request is aborted (#4317).
