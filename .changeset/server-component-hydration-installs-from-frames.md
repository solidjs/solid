---
"solid-js": patch
"@solidjs/web": patch
---

The server-component half of hydration installs from `@solidjs/web/frames`' `installServerComponents()`, not from `hydrate()`: `sharedConfig.holdBoundary` (the client hold on adopted markup counted as a pending boundary), `sharedConfig.hydrateWindow` (the claim window an adopted occurrence re-enters hydration through), fragment ownership by rendering (the `_$HY.fa` term of the reveal policy) and the ledger's published answer `_$HY.fr` on the solid side; the declared claim roots (`sharedConfig.claimRoots`) and the frame-region exclusion of the root sweep on the DOM runtime's side. A hydrating page without server components carries none of it — −686 B minified / ≈ −205…−243 B brotli on the hydrating apps (this returns the bytes the frames A0 correctness pass added to every hydrating page); a server-component page pays the two installers' glue (≈ +220 B minified).

Public surface (`@internal`): `enableServerComponentHydration()` on `solid-js` (runtime) and `solid-js/internal` (typed), a no-op on the server entry; `installServerComponentHydration()` on `@solidjs/web`, which installs both halves — the frames client calls it where it installs its reveal hook.
