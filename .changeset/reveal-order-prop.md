---
"solid-js": patch
---

Replace `Reveal`'s boolean `together` prop with an `order` string union
(`"sequential" | "together" | "natural"`) and add the new `"natural"` mode.

- `order="sequential"` is the default and matches the previous default behavior.
- `order="together"` replaces `<Reveal together>`; existing `together` props must be migrated to `order="together"`.
- `order="natural"` is new. A nested `<Reveal order="natural">` group opts its own
  children out of the outer frontier (each child reveals as its own data resolves),
  while the group as a whole still acts as a single composite slot to the enclosing
  `<Reveal>`. This closes the gap where a nested subtree needed to respect its parent's
  broader ordering while returning to natural, independent reveal behavior internally.
- `collapsed` is only consulted when `order="sequential"` (the default). It is
  silently ignored under `order="together"` or `order="natural"` — no type error,
  so dynamic `order` bindings don't need a discriminated-union workaround.
- `RevealOrder` (the `"sequential" | "together" | "natural"` string union) is
  exported from `solid-js` for use in consumer code that types the prop directly.
- `renderToString` now supports `order="natural"` out of the box (no streaming required).
- `createRevealOrder` options changed from `{ together?, collapsed? }` to
  `{ order?, collapsed? }` with the same accessor shape.

See `documentation/solid-2.0/03-control-flow.md` for the full outer/inner nesting
matrix and SSR caveats.
