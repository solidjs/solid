---
"@solidjs/web": patch
---

Fix an rc.7 SSR hydration regression: a self-closing element that spreads props containing `children` (`<a {...props} />` in a wrapper component) read the compiled `children` getter twice on the server, building the child element twice and consuming a hydration id the client never allocates. Every element after the first such spread then hydrated against the wrong node and the client halted. `ssrElement` again reads each spread key at most once and never reads `children` when JSX children are present; the textarea `value`/`defaultValue`-as-content behaviour from #3286 is preserved.
