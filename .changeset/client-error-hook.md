---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

The client error hook — `configureClientErrors({ onError })` from `solid-js`, and `render`/`hydrate`'s `onError` option in `@solidjs/web`: the prod-tier seam through which an app, or an error monitor, hears the one failure nothing else can see — an `<Errored>` / `createErrorBoundary` collected it and renders its fallback. The twin of the server's `configureServerErrors`. An uncaught error is not this hook's: the halt (`REACTIVITY_HALTED`) hands its cause to the platform's `reportError`, the channel every monitor already listens on.

Once per error object (a `reset()` re-collecting the same failure says nothing new; a primitive is reported per sight); `ownerPath` carries the component labels where the runtime keeps owner names; no return — the client has no wire to map for; a throwing hook is reported and ignored. A root's own hook wins over the ambient one for failures under it.

Pay-for-use: the hook machinery (`core/error-hooks.ts`) is retained by `createErrorBoundary` or the app's own `configureClientErrors` import; a root's hook is parked on the root owner under the registered `ROOT_ERROR_HOOK` symbol (defined in the scheduler), so `render` retains nothing for an app that passes none. Core floor unchanged; apps with a boundary +~200 B.

**The server surface consolidates on the same name.** `onError` on `renderToStream`/`renderToString` and on `handleServerFunctionRequest` _is_ the server error hook (`(error, context) => wire | void`); `onServerError` is removed. A one-argument `onError` written for the old shape keeps working and now hears every handled failure — filter on `context.handling === "failed"` for the request-failing ones alone. New `handling: "serialize"` for a hydration value that would not serialize (what seroval's `onError` reported, for a render that passed one). With no hook anywhere, a failure that fails the request still reaches `console.error`.
