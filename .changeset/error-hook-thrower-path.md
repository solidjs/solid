---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

The error hooks and `SSR_RENDER_ERROR_CONTAINED` tell where an error was thrown apart from where it was met.

`ownerPath` on `ClientErrorContext` and `ServerErrorContext` is now where the error was **thrown**: the labels root-first up the owner chain of the computation that threw — the component that broke — falling back to the boundary's chain when the throw crossed nothing the runtime could name. A new `boundaryPath` is where it was **met**: the same labels up the chain of the `<Errored>` that rendered its fallback (client and server) or the `<Loading>` that shipped the rejection (server, `handling: "client"`). Before, `ownerPath` was the boundary's on both sides, so every component under one boundary grouped into one path. On the client the engine's status wrapper already named the thrower (`StatusError.source`); on the server the owner scopes stamp it as the error escapes. The `SSR_RENDER_ERROR_CONTAINED` finding follows: `ownerPath` locates the throw, `data.boundary` / `data.boundaryPath` the boundary.
