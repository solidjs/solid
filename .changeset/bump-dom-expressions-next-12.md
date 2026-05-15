---
"@solidjs/web": patch
"babel-preset-solid": patch
---

Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.12.

This picks up root-owned delegated event targeting: `render()` and `hydrate()` own delegated listeners for their root containers while compiler-emitted `delegateEvents([...])` declares only the delegated event names needed by compiled JSX.
