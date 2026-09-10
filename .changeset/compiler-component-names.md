---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"solid-js": patch
---

Compiler `componentNames` option: component owner labels that survive minification. With the flag on, DOM output carries the tag as written in source as a third `createComponent` argument — `<Home />` compiles to `createComponent(Home, props, "Home")`, `<Ui.Button />` to `"Ui.Button"`, `<this.Row />` to `"this.Row"` — and the dev and observe runtimes label the component's owner with it (`<Home>` in diagnostic `ownerPath`s, attribution chains, and the devtools `_component.name`), falling back to `Comp.name` as before. Until now an observe-tier production bundle reported hot scopes and holds under whatever the minifier left of the function name (`<Xt> › <Kn>`), and a `lazy()` or HMR wrapper hid the tag name even in dev. Off by default and byte-identical output when off; SSR (which inlines the call) and universal output never emit it; the production `createComponent` ignores the argument. Both compilers implement it in parity (shared fixtures, cross-mode ratchet). `@solidjs/vite-plugin` enables it for the dev and `observe` postures.
