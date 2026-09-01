# solid-refresh fixtures

Each fixture directory contains:

- `code.{js,jsx,tsx}` — the input module.
- `options.json` — optional overrides merged over the vite-plugin-solid
  defaults (`{ bundler: "vite", fixRender: true, jsx: false }`). This is the
  option surface the Babel plugin exposes (`bundler`, `granular`,
  `fixRender`); `importSource` is native-only and tested separately in
  `refresh-options.test.js`.
- `expected.js` — the **frozen reference**: the output of the actual
  solid-refresh Babel plugin (`solid-refresh@0.8.0-next.7`,
  `dist/babel.mjs`), normalized through the harness's Babel re-print
  (printer cosmetics only — literal raws, shorthand, import aliasing,
  comments stripped). These files are the spec for the native pass.
  `refresh-parity.test.js` compares `transformRefresh` output (run through
  the same normalization) against them byte-for-byte AND compares the
  embedded xxhash32 `signature` hashes explicitly — the hashes are the
  HMR-stability contract and are only bit-exact while the native signature
  printer reproduces @babel/generator's default print of the component.
- `output.js` — snapshot of the raw native output, guarded by
  `refresh-fixtures.test.js`. Regenerate with
  `UPDATE_REFRESH_FIXTURES=1 pnpm exec vitest run __tests__/refresh-fixtures.test.js`.

The `sig-*` fixtures are deliberate printer torture cases that lock in the
bit-exact signature guarantee: statement/expression/JSX/class/async/comment
formatting, including the regressions found while porting (array-pattern
rest commas, exponentiation left-operand parenthesization, JSX child
indentation, directive quoting).

Fixtures use relative filenames (`src/<fixture>.<ext>`) so the `location`
metadata in the frozen files doesn't depend on the machine or working
directory they were generated on.

The `expected.js` files have no update script on purpose: they change only
when the pass's behavior is changed deliberately, by editing them by hand
(or regenerating with a one-off script against the Babel plugin) in the
same commit that changes the transform, with the diff reviewed as part of
that change.

The `call-expr-*` fixtures are **native-first** (deliberate divergence from
the frozen Babel reference, like the merged-function handling): call-shaped
component registration (#3090) does not exist in the frozen solid-refresh
plugin, so their `expected.js` was generated from the native output
(normalized through the same harness re-print) and reviewed as the spec.

## Deliberate divergences from the Babel plugin

These fixtures freeze behavior where the native pass intentionally departs
from solid-refresh@0.8.0-next.7 (their `expected.js` files are the native
pass's intended output, not the plugin's):

- **TS declaration merging** (solid-refresh#76, vite-plugin-solid#145;
  `merge-namespace`, `merge-namespace-ts`): the plugin rewrites every
  component `function A() {}` into `const A = $$component(...)`, which
  breaks when a same-name `namespace A` merges with the function — esbuild
  rejects `const A`/`var A` next to `namespace A` ("The symbol A has
  already been declared"), and the post-strip namespace IIFE
  (`(function (A) { ... })(A || (A = {}))`) conditionally assigns the
  binding, which `const` turns into a potential TypeError. The native pass
  detects a same-name top-level *value* binding (namespace/module, enum,
  class, var) or a module-level write to the function's own binding, and
  leaves such declarations untouched — a per-component `@refresh skip`:
  the component still renders, it just isn't hot-wrapped. Type-only
  merges (interfaces, type aliases, ambient `declare` declarations,
  bodiless overload signatures; `merge-type-only`) are erased by the TS
  strip and still wrap.
- **Imported JSX tags in `dependencies`** (`deps-jsx-imports`): the plugin's
  `getForeignBindings` skips plain JSX identifier tags entirely (only
  member-expression roots count). That is right for same-module components —
  their `$$component` proxy gets a new identity on every re-execution, so
  counting them would remount everything on every edit — but wrong for
  *imported* bindings: when an edit bubbles from the imported module, a
  consumer that references the import only as a JSX tag has an unchanged
  signature and unchanged dependency identities, so `patchComponent` skips
  it and it keeps rendering the stale module instance while sibling non-JSX
  references swap over (split-brain; reproduced as a `ContextNotFoundError`
  when a re-created context's old `Provider` stays mounted). The native pass
  includes a plain JSX tag in `dependencies` iff the identifier resolves to
  an imported binding (any import form; scope-aware, so a component-local
  variable shadowing an import doesn't count, and type-only imports are
  ignored). Member-expression roots still count unconditionally.
- **Member-expression refs** (solid-refresh#77; `ref-member-passthrough`):
  not a divergence but a documented non-bug — the crash lives in the
  plugin's `jsx: true` extraction (`extractJSXExpressionFromRef`
  safe-wraps identifier refs but lets member expressions fall into a
  props getter that the runtime's non-function ref fallback then
  assigns to). Under `jsx: false` — the only mode vite-plugin-solid uses
  and the only mode the native pass accepts — JSX is never rewritten, so
  `ref={props.setRef}` passes through verbatim and the code path is
  unreachable. The fixture locks the pass-through in.
