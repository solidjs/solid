---
"@solidjs/web": patch
"solid-js": patch
---

Fix `dynamic()` and `lazy()` gating the SSR shell flush instead of suspending into their boundary

Both registered their source promise as a renderer-blocking promise, so the document's first flush waited on it. An enclosing `<Loading>` never rendered its fallback and a slow source stalled the entire document — a 500ms server component pushed the shell from 27ms to 527ms with nothing streamed, and an un-preloaded `lazy()` held the shell for the full module load.

The pending read now simply suspends, letting the nearest boundary own it and stream the content in behind its placeholder. Where there is no boundary to defer to the read becomes a root hole and the renderer blocks the shell on it as before, so a bare `dynamic()` or `lazy()` still resolves inline. Near-instant sources and preloaded modules continue to inline with no fallback flash.

For `lazy()` this does not affect asset ordering: `assetsPending` gates the render memo separately, so a fragment still cannot flush before its styles and module map are registered.

Also adds an internal `serialize: false` option to the server `createMemo`, which keeps a value out of the hydration payload while the subtree still hydrates normally (unlike `NoHydrateContext`, which opts the subtree out entirely and suppresses the id allocation needed for client parity). It carries the contract that the client recomputes the value. This lets the server `dynamic()` drop its hand-rolled promise tracking and mirror the client's two-memo shape, since its resolved value is a component function that must never cross the wire.
