---
"@solidjs/compiler": patch
"@solidjs/web": patch
---

Module-level "use server" exports now register by value: the server build registers each export's evaluated terminal initializer whole, so server-side wrappers compose onto every call path — `export const getUser = withValidation(schema, fn)` applies the wrapper to HTTP dispatch and in-process SSR calls alike, and patterns like `withDelay(fn, 400)` work for server mocks. The client build always emits bare references, so wrappers, schemas, and helpers stay server-only by construction. The compiler never inspects the initializer's shape; `registerServerReference` now throws at module eval when handed a non-function, turning stray non-function exports into loud boot errors instead of dead references. Anonymous default expressions (`export default withDelay(...)`, `export default async () => ...`) get a synthesized binding and register too — previously they were silently dropped from both builds. Supersedes the unreleased wrapped-export compile error.
