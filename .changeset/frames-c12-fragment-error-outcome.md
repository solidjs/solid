---
"solid-js": patch
"@solidjs/web": patch
---

A server `<Loading>` inside a server component that fails after the first flush renders the server's outcome into its fragment instead of a blank (C12 (c), frames-rulings 3.3): the nearest server `<Errored>`'s fallback for the error, at the `<Loading>`'s position (asked through the boundary error handler's new `outcome` mode; a `<Loading>` between passes the question up); with no server `<Errored>` the error escapes the component — the frame's own `:error` on the stream face (an unkeyed `error` chunk), a frame-addressed `{ type: "error", fid, error }` op on the document face's `sc:live` channel (only the owning adopted boundary applies it) — and the position keeps the boundary's own fallback. `_fr` still rejects and the keyed error chunk still rides (the diagnostics). Outside a server component nothing changes (the blank the client twin renders fresh over). `HydrationContext.registerFragment`'s resolver gains a third argument (`escaped?: { frame?: string }`) and the context an internal `frameId`.
