---
"solid-js": patch
"@solidjs/web": patch
---

Public hydration API, so data libraries (Solid Router, TanStack Solid Query / Router) no longer reach into `sharedConfig` from `solid-js/internal`:

- `isHydrating()` (`solid-js`): whether the running code is claiming server-rendered DOM — the root pass of `hydrate()`, or code under a streamed boundary while that boundary resumes. `false` on the server. Not reactive.
- `isHydratable()` (`solid-js`): whether the calling owner sits where hydration applies — `false` under `<NoHydration>`, `true` again inside a nested `<Hydration>`, `false` with no owner; on the server it also requires the owner to belong to a render in progress. The client `<Hydration>` stays a passthrough: a client `<NoHydration>` zone renders only outside hydration, so there the answer stays `false`.
- `getHydrationWriter()` (`@solidjs/web`, server): the caller's render's keyed server-to-client channel, found through the owner, else through the request scope when exactly one render is open for the request; `undefined` outside a render and on the client. `write(key, value, { deferStream })` — the first write of a key wins, a key counts as written only once serialized, a write after the render closed returns `false`, and a promise under `renderToString` throws. Writes are not gated on `<NoHydration>`: the library decides with `isHydratable()`.
- `takeHydrationValue(key)` (`@solidjs/web`, client): reads and removes the value written under `key`, as a `HydrationValue` — `resolved`, `rejected`, or `pending` with the streaming promise. `undefined` on the server. Tests can seed `globalThis._$HY = { r: { key: value } }`.
- New types `HydrationWriter` and `HydrationValue` (`@solidjs/web`).
