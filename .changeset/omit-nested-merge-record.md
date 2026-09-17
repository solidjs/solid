---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

`omit()` over a `merge()` is one record that holds the merge's record, not one leaf view per merge source

An omit over a merge used to flatten at construction: one `OmitView` plus one combined hidden-key list per flattened leaf, and the next `merge()` copied those entries into its own arrays. On a component chain of defaults + omit + spread (Kobalte-shaped: `merge(omit(merge(omit(props))))`, four layers) that was ~19 records and as many list copies per element — the largest allocation of the render. The omit now holds the `MergeView` record itself (a new source kind, `SOURCE_MERGE`) and is one record however many leaves the merge has; a later `merge()` carries it as one entry, and a later `omit()` folds into it. Nothing is read through a proxy trap along the way: the entry helpers (`sourceKeys`/`sourceHas`/`sourceGet`, `hasStaticKeys`, descriptors, the resolved table) recurse into the record by function call.

- Reads through the nesting are one walk per read (a nested entry answers presence and value together), and a nested record counts no reads of its own toward the table threshold — the view that was asked decides for the whole tree, and its table is collected in one pass over the leaves rather than one table per layer.
- New `@internal` `sourceOwners(source, keys, owners)`: every key of a props source — a plain object, a store, or a merge/omit view — appended in merged order with the object that owns it, in one pass, later sources moving a key to the end. `ssrElement` collects any spread that is not plain objects only (a view, a store, the array form with one among them) this way, so each attribute is one direct read of its owner — no `in` walk per key through the layers, no key list per leaf, no table, and no per-entry classification (`pushEntry` is gone).
- An omit's `$SOURCES` never answers anything now (previously its filtered leaf views); consumers reach the record through `viewOf` and walk it as one filtered entry.

Measured against `next` (interleaved, min of N, quiet machine): the tier-1 polymorphic-chain SSR harness allocates 12% less per row (14.6 → 12.8 KB) and is 2–6% faster across the interpreter, Sparkplug, Maglev and TurboFan tiers; the props-chain microbench builds 6–65% faster and builds+consumes 7–31% faster by depth and tier; the omit/merge micro-suite is flat or better in every shape. On the yak-bench SSR lanes with every yak piece on Solid primitives: +7% geomean, +20–36% on the component-composition cases (`polymorphic-chain`, `tabs`, `multifile-composition`), which brings those to parity with yak's hand-rolled runtime.
