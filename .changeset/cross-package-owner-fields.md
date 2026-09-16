---
"@solidjs/signals": patch
"solid-js": patch
---

`_parent` joins `_name` as a field signals' property mangling reserves — the two cross-package owner fields.

Signals' prod and observe artifacts rename every `_`-prefixed property except a reserved list; the dev artifact (which the test suites run against) is unmangled. Two things read `_parent` across the package boundary and only worked in dev:

- `solid-js`'s client hydration walks `owner._parent` to the root to mark the hydration snapshot scope. In the built prod and observe artifacts the walk found nothing and marked the current owner instead, so computations created outside that owner's subtree during hydration read live values rather than the server snapshot.
- The core's owner walks — `ownerPath` and `OBSERVE.exclude`/`isExcluded` — over `solid-js`'s server owners. `ownerPath` had a server-side shim (`located()`, now removed); `OBSERVE.exclude` was a silent no-op for a server owner outside dev.

Cost: ~40 B brotli on the prod app scenarios; the observe scenarios did not grow. Pinned from both ends: `packages/solid/test/cross-package-fields.spec.ts` checks the reserved fields survive in the mangled artifacts and scans the built client artifacts of `solid-js`, `@solidjs/web` and `@solidjs/universal` for any signals `_` field that is not reserved; `packages/web/test/server/server-owner-walks.spec.tsx` runs `ownerPath` and `OBSERVE.exclude` over server owners against the built observe and development artifacts.

Also: RFC 08 gains "Values in records — the PII surface", the complete list of record and finding fields that carry user data (value previews, interaction target text, navigation paths/params, `data.error` on the server error findings) for exporters that leave the process.
