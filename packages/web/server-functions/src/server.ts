// Bridge entry: rollup bundles the runtime
// implementation through this specifier (solid-js and seroval stay
// external). Event scoping needs no configuration here — the runtime falls
// back to the AsyncLocalStorage that @solidjs/web/storage's
// provideRequestEvent parks on globalThis[RequestContext] (a registered
// symbol, so the separately bundled copies agree).
export * from "../../src/server-functions/server.js";
