---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.
