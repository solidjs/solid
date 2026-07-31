---
"@solidjs/web": patch
---

Emit early preload hints for `clientOnly` modules. The bundler's module-URL
pass (the same one that annotates `lazy()`) now also annotates
`clientOnly(() => import("x"))` calls, and the server half resolves the
module's client assets through the manifest seam lazy uses, emitting plain
link hints (`modulepreload` for js, stylesheet links for css) so the browser
fetch starts on HTML arrival instead of when the client bundle evaluates the
`clientOnly()` call. Deliberately not filed into the hydration asset map:
the module is not required for hydration — the fallback is what hydrates —
so mapping it would make the "preloaded before hydration" contract lie.
Without an injected module URL (untransformed code) or an asset manifest,
behavior is unchanged.
