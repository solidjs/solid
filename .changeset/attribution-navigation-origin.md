---
"@solidjs/signals": patch
---

Router-agnostic navigation attribution: `OBSERVE.attribution.withOrigin({ kind: "navigation", name, to, from, params }, fn)`

A navigation in Solid 2 is a plain write to the location; the runtime already sees everything it costs (the hold behind route data, the re-runs, the silence) but not that the writes were a navigation, or to which route. `withOrigin` is the seam where a router says so, around its write — the one router-specific line, living in the router. From it the attribution engine:

- stamps the writes with a `navigation` origin (new `ChangeOrigin.kind`, with `name`/`to`/`from`/`params`), nested under the enclosing interaction — including through an action step — so cause chains read `— navigation to /users/:id (under click on a.nav "Alice")`;
- names holds by route: `HoldEvent.origin`, `SILENT_HOLD`/`LONG_HOLD` messages that start from the navigation, and `data.navigation` on the event;
- keeps one `NavigationEvent` per frame (`attribution.navigations()`), settled exactly once as `committed` (a plain drain took the writes), `held` (with the `HoldEvent` attached), or `superseded` (a later write replaced them before they landed);
- folds settled navigations per route into `feedback().navigations`.

The ref is read late on purpose. `name`/`to`/`params` are re-read from the object when the navigation settles, so a router whose match is coarse at write time (a lazy route subtree resolving inside the hold) assigns the exact pattern onto the same object and every consumer reads it — no second API. A redirect is declared with `redirect: n` (the hop depth routers already track) and folds onto the pending navigation instead of opening one: one record, timed from the user's request, the abandoned destination kept in `NavigationEvent.redirects`, `feedback().navigations[].redirected` counting them, and `formatOrigin` reading `navigation to /login (redirected from /users/42)`.

Hold census fix: a `latest()`/`isPending()` companion now counts as acknowledgement only when an effect reads it, through however many memos. Memos compute eagerly, so a router's internal `createMemo(() => isPending(location))` used to clear `SILENT_HOLD` for every navigation whether or not anything rendered it.

One new core hook, `flushEnd`, fires once per `flush()` drain so the engine has the "committed and effects ran" instant for writes no transition held. Prod builds are unchanged (the hook site folds out; only the inert attribution twin gained the new empty queries).
