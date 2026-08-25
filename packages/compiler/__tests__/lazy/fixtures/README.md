# `lazy()` module-URL fixtures

Each fixture directory contains:

- `code.{js,jsx}` — the input module.
- `expected.js` — the **frozen reference**: the output of the original Babel
  implementation (vite-plugin-solid `src/lazy-module-url.ts` at commit
  `380d2f0`, transpiled and executed via that checkout's own @babel/core),
  normalized through the harness's Babel re-print (printer cosmetics only —
  literal raws, shorthand, import aliasing). These files are the spec for
  the native pass. `lazy-parity.test.js` compares `transformLazy` output
  (run through the same normalization) against them byte-for-byte, plus the
  raw `"__SOLID_LAZY_MODULE__:<specifier>"` placeholder format that the
  bundler plugin's `resolveLazyModuleUrls` regex consumes.
- `output.js` — snapshot of the raw native output, guarded by
  `lazy-fixtures.test.js`. Regenerate with
  `UPDATE_LAZY_FIXTURES=1 pnpm exec vitest run __tests__/lazy-fixtures.test.js`.

Fixtures use relative filenames (`src/<fixture>.<ext>`) so the frozen files
don't depend on the machine or working directory they were generated on.

The `expected.js` files have no update script on purpose: they change only
when the pass's behavior is changed deliberately, by editing them by hand
(or regenerating with a one-off script against the Babel reference) in the
same commit that changes the transform, with the diff reviewed as part of
that change.
