---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"solid-js": patch
---

`componentNames` now applies to SSR output. Under the option both compilers keep the `createComponent` call they otherwise inline to `Comp(props)` and pass the source tag name — `createComponent(Comp, props, "Comp")` — so the server runtime's observe/dev `createComponent` labels the owner and a server finding's `ownerPath` reads `<App> › <Page>` like the client's. Without the option (prod builds) SSR output is unchanged. `@solidjs/vite-plugin` already passes the option for its dev and observe postures, so app server builds pick this up with no config change.

Fixes `ssrScope` under transparent owners: the virtual hole scope swapped the current owner's id counter, but content inside a hole resolves ids by walking past transparent owners, so with one in between (the server-component scope owner; now the labelled component owner) the hole's content took ids from the enclosing counter and disagreed with the client. The scope now swaps the nearest id-bearing owner.
