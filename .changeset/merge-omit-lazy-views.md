---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
"@solidjs/html": patch
---

`merge()` and `omit()` are always lazy views, and props consumers read their leaves

`omit(props, ...keys)` returns a live view of `props` for every input — a plain object included — instead of copying it with a `getOwnPropertyDescriptor` + `defineProperty` per prop. A predicate form hides keys by rule without enumerating first: `omit(props, k => k[0] === "$")`. `merge()` no longer builds an eager copy when its sources are plain objects: under `Proxy` it always returns an O(1) view over the flattened sources (a single non-function source is returned as is).

The two compose flat. An `omit()` over a `merge()` carries one filtered view per flattened merge source, a `merge()` over an `omit()` takes the view record as a leaf, and nested omits fold their filters into one record. A component chain of `merge(defaults) → omit(consumed) → merge(statics) → omit("as")` — the shape headless-UI libraries render every element through — collapses to leaf views over the original objects, each with its accumulated filter, with no proxy layer left between the outermost spread and the author's props. `merge()` keeps the omitted keys hidden by construction (#3014) rather than by treating the omit as opaque. Construction cost drops 3–7× at depth 1–7; the SSR polymorphic-chain bench (#3448) runs ~2.4× faster.

Reads stay cheap: a view over plain objects resolves a key → owning-leaf table once, on first read, and every `get`/`has`/descriptor is one lookup after that. `spread()` (DOM and universal) and `ssrElement()` read the leaves directly — never through the proxies' traps — and walk that table when there is one, so an effect rerun costs one read per key, as it did over the copy. Both proxies use a class target and one shared handler (no per-instance closures).

A view over a store asks the store nothing but the read. Each source's kind (plain object, omit record, proxy, memo) is decided once, when the view is built, and carried beside it — every brand check on a Proxy is a trap (`instanceof` is a `getPrototypeOf` trap, as expensive as a store read), and store detection goes through `$TARGET`, a symbol the store's `get` trap answers on its fast path, never its generic tracked-read path. `merge(defaults, store)` constructs ~30% faster than the copy did and reads ~15% faster; `omit(store)` reads at parity.

The views tell the truth: `Object.getOwnPropertyDescriptor(view, key)` reports a data descriptor only when the key is a data property of a plain leaf (the compiler's encoding of a static prop) and an accessor for a getter, a store key, or a memo source. Together with the new internal `hasStaticKeys()`, `spread()` now skips the children effect for static children behind `omit`/`merge` layers (#3388 through views).

Behavior changes:

- Writes to a `merge()` or `omit()` result are no-ops (they already were for the proxy forms). A caller that needs its own object copies it (`{ ...merged }`), and the copy carries no sources (#3384). `@solidjs/html` now collects its own props and spreads into one `merge()` at the end instead of assigning onto the result.
- A data property on a source is read live through the view rather than snapshotted at `merge()`/`omit()` time.
- Key order of a merged view is the merged order — every key at the position of the last source that carries it — matching `ssrElement`'s array form.
- Sources are treated as own-keyed; a key added to a plain source after merging is not seen (the copy did not see it either).
- Enumerating a view through its traps (`for…in`, `Object.keys`, `{ ...view }`) costs a trap per key, as any proxy does; the internal consumers avoid it. Environments without `Proxy` keep the copy paths.

Internal helpers for consumers, exported from `solid-js`: `viewOf(o)`, `mergeView(o)`, `omitView(o)`, `sourceKeys(entry, kind)`, `sourceHas(entry, kind, key)`, `sourceGet(entry, kind, key)`, `hasStaticKeys(o)`, `resolvedTable(o)`, the `SOURCE_*` kinds.
