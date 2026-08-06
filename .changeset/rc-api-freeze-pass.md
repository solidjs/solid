---
"@solidjs/web": patch
---

RC API-freeze pass over the web surface (rides the matching `@dom-expressions/runtime` pass):

- **`@solidjs/web/server-functions/rich-args`** ships. `enableRichArguments()` installs the codec's write half (~5 KB gz) as the client transport's `serializeArgs`, replacing the plain-JSON default that throws a directed message on Dates, Maps, Sets, typed arrays, and cycles. Importing the entry is the opt-in at the module-graph level — the serializer ships only when the app asks for it — and it externalizes against the shared `server-functions/client` instance, so the config write lands where the compiled reference proxies read.
- **`renderToStringAsync` is gone** (server entry and browser mock). It was `renderToStream().then()` in a trench coat; `renderToStream` is now a real `PromiseLike<string>`, so `await renderToStream(code, options)` is the replacement — same options, resolves to the fully settled HTML.
- **Server-function error sanitization keys on the build variant, not `NODE_ENV`.** The server-functions server entry now builds twice: the copy behind the `development` export condition (what Vite dev resolves) keeps full error fidelity, and every default resolution — production bundles, plain node, deep imports with no bundler signal — gets the sanitizing copy, failing safe. `markSafeError`/`isSafeError`/`SAFE_ERROR` export from the core entry next to the response helpers for intentional client-facing errors.
- **`@solidjs/web/serialization` is marked integration-facing** — exempt from the 2.0 stability guarantee, per-export — and is now the single home of `createJSONDataTable` (the `/frames` duplicate re-export is removed).
- **Every `/frames` export carries `@experimental` JSDoc** plus a banner per entry file, matching the changeset-level experimental framing.
- **The browser mock matches the runtime signatures** (`onHead`, resolver-form `manifest`, `ssrClassName`/`ssrStyleProperty`/`ssrGroup`, `createRequestEvent`'s generic, `createSSRResponse` over `RequestEvent`), with a type-level test so drift can't recur, and compiler-output-only exports and wire plumbing are marked `@internal`.
