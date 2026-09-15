---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
---

Move the runtimes' seams off the `solid-js` surface and behind `solid-js/internal`

`merge()`/`omit()` returning lazy views (#3454) gave `spread()` and
`ssrElement()` a protocol for reading props leaf by leaf instead of trapping
through the proxy per key. Because `@solidjs/web` and `@solidjs/universal`
depend on `solid-js` alone — never on `@solidjs/signals` directly, so an app
holds exactly one reactive engine — every piece of that protocol went out
through `solid-js`'s main export: eleven names, `mergeSources` before them in
#3325, on the public surface with no marking. None of it is API.

The protocol (`viewOf`, `mergeView`/`omitView`, `MergeView`/`OmitView`,
`sourceKeys`/`sourceHas`/`sourceGet`, `hasStaticKeys`, `resolvedTable`, the
`SOURCE_*` kinds, `SourceKind`) now lives on a `solid-js/internal` subpath,
along with the server-scope seams that were already `@internal` in JSDoc and
consumed only by `@solidjs/web` (`ssrHandleError`, `ssrScope`,
`runInServerComponentScope`, `inServerComponentScope`, `creationStamp`,
`getProjectionTrace`, `materializeContainerTrace`). The names stay exported
from the main entries at runtime, so the subpath shares one module state and
the single-engine guarantee is untouched; `stripInternal` keeps them out of
the generated declarations, so TypeScript no longer offers or types them.
`internal-surface.spec.ts` pins the boundary in both directions.

Also dropped from the entries: `storeIsShallow`, `storeHasFamily`,
`storeHasOptimisticFamily` (leftovers of the gutted patch channel),
`storePath` and `$REFRESH` (referenced only by `@solidjs/signals`'s own
internals), and `NoHydrateContext` (`@internal`, used only by `solid-js`'s
server code). Nothing in the repo consumed them.

No runtime behavior change. `merge`, `omit`, and the rest of the reactive
surface are unaffected.
