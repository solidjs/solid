---
"@solidjs/web": patch
"solid-js": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Fix SSR XSS: strings yielded by flow-control memos rendered unescaped

`<Show when={s}>{s}</Show>`, `<For>{v => v}</For>`, `<Dynamic component={() => s} />`,
`<Switch>/<Match>`, boundary fallbacks and any component that returns a string through a
memo rendered that string raw on the server. The server flow controls return memos for
hydration-id alignment; `escape()` passed functions through by identity, and the resolver
appended whatever they later produced without escaping.

One rule now: `escape(x)` at a hole covers everything reachable from `x` — strings, array
items, and what a function yields when the resolver calls it (a deferred-escape wrapper).
Finished `{ t }` nodes pass through. `Loading` escapes its content the way it already
escaped its fallback. The compilers stop wrapping fragment / mixed component children in
`_$escape` (they are values; escaping them too double-escaped through
`<Comp>{props.children}</Comp>`), and a single-expression fragment at a hole keeps the
hole's wrap. Live-hole tags ride the wrapper and `$slot` survives the array copy, so
frames behave as before.
