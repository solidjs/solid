---
"@solidjs/web": patch
"@solidjs/signals": patch
---

SSR element and props-view fast paths for the per-element hot path. `ssrElement` takes an optional trailing `attrs` — attribute markup the caller already holds (a spread element's trailing attributes, a class a library computed and knows is clean), a string or a thunk called after the sources are walked — appended after the props' attributes in place of a `{ class, style }` source that was built, keyed and precedence-walked on every render; `ssrElementAttribute(key, value)` (compiler primitive) serializes one attribute by the spread walk's rules for such a thunk; the void-tag test and the attribute-name escape are remembered per name, and a plain props body is read and keyed in place instead of through the source helpers. `merge()` sizes its source arrays up front and its `get` trap walks plain sources directly, reading before the `in` check. No output changes.
