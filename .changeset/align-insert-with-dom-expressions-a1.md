---
"solid-js": patch
---

Drop the solid-side support machinery for dom-expressions' old
`memo(accessor, true)` wrap in `insert()`. That wrap has been replaced in
dom-expressions with a conditionally nested render-effect pattern that
splits the accessor's creation scope from its read scope — fixing stale
reads and transition-ownership regressions (the Sierpinski hover freeze)
without reintroducing the #2610 sibling re-render.

Solid-side companion cleanup:

- `@solidjs/web` `memo` helper collapses to `createMemo(() => fn())` and
  drops the `coreMemo` import; the `transparent` branch and `$r`
  short-circuit are no longer reachable.
- `@solidjs/signals` `accessor()` no longer tags the returned function
  with `$r`.
- `@solidjs/web` drops `@solidjs/signals` from `peerDependencies` and
  `devDependencies` — it reaches signals transitively through
  `solid-js`.

No public API changes. Coordinates with a forthcoming dom-expressions
release.
