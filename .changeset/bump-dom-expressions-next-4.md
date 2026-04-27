---
"solid-js": patch
---

Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.4. Picks up the hyperscript callback-prop materialization fix (returning `h(Comp, …)` from a render-prop callback no longer re-mounts stable rows on parent updates) and the upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Drops the local workarounds in `@solidjs/web` (explicit constants re-export and the `client.d.ts` skip in `types:copy-web`). Folds the For-row regression cases into `@solidjs/h`'s smoke suite as plain tests.
