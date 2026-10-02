---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/web": patch
---

Fix computed keys in compiled SSR `style` objects (builds without `serverComponents`). A computed key's name got no `;`, so `style={{ color: "red", [k]: v }}` rendered `color:redtop:1px` and the browser dropped both declarations. Hydration keeps the server's inline style, so they stayed dropped. A nullish first value also no longer leaves a leading `;`. Both compilers now pass a multi-entry object to a new `ssrStyleProperties(name, value, …)` helper, which writes the separator only between the entries it writes; a single entry keeps `ssrStyleProperty`.
