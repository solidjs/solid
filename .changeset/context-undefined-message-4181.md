---
"@solidjs/signals": patch
"solid-js": patch
---

Clearer dev message for `ContextNotFoundError` (#4181). `undefined` still means "not provided" for context, but the message now names the context and says which case it hit: no provider and no default; a `createContext(undefined)` default, which is no default; or a provider that passed `undefined`, which counts as not provided. Each suggests `null` as the explicit empty value (`createContext<T | null>(null)`). Applies on the client and the server. Production messages and bundles are unchanged. The context docs and cheatsheet now say that `undefined` is "not provided" and that `null` is how to make a context optional.
