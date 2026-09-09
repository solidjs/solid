---
"@solidjs/signals": patch
---

Fix `deep()` over optimistic and derived stores missing writes it should hear, and derived views churning row identities under an optimistic overlay (#3323).

- `deep(view)` / `deep(view[i])` over a derived view — `createOptimisticStore(base)` or a projection whose backing is another store — never re-ran when the base store was written, while per-key reads on the same view did. A view's targets chain to the inner store's proxies and base writes bump the inner record's witness nodes; the walk never subscribed them, and it resolved children to fresh non-chained wrappers of the base raw instead of the chained row targets the view serves. The walk now reads through the whole chain and resolves children to the targets the get trap would serve.
- `deep()` over any optimistic store was deaf to every write on a row added under a held action: the row lives in presence/value overrides, not the committed backing, and the walk enumerated the raw backing. The `ownKeys` / `getOwnPropertyDescriptor` trap bodies are now shared helpers the walk uses, so the walk sees exactly what readers see.
- A derived view's untouched rows came back as fresh proxies for the life of an optimistic action (`view.map(r => r)` was O(n) new identities per action) and snapped back at settle. The optimistic diff compared the inner store's child proxies to the draft's raws and marked every row changed; it now compares unwrapped values. Chained targets serving from a pending backing resolve inner-owned raws to the inner proxy before wrapping, and `snapshot()` composes outer overrides below the root.

Only `deep()`, the chained-view read path, and the optimistic diff changed; plain-store reads and writes are unaffected.
