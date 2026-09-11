# `"use server"` directive fixtures

Each fixture directory contains:

- `code.{js,ts,jsx,tsx}` — the input module.
- `expected.server.js` / `expected.client.js` /
  `expected.server.dev.js` / `expected.client.dev.js` — the **frozen
  reference**: the output of the original Babel implementation
  (vite-plugin-solid `src/server-functions/` at commit `c052963e`), generated
  one final time before that implementation was retired, normalized through
  the harness's Babel re-print (printer cosmetics only — literal raws,
  shorthand, import aliasing). These files are the spec for the native pass.
  `directives-parity.test.js` compares `transformDirectives` output (run
  through the same normalization) against them byte-for-byte.
- `output.server.js` / `output.client.js` / `meta.json` — snapshots of the
  raw native output and reported function metadata (production mode),
  guarded by `directives-fixtures.test.js`. Regenerate with
  `UPDATE_DIRECTIVES_FIXTURES=1 pnpm exec vitest run __tests__/directives-fixtures.test.js`.

The `expected.*` files have no update script on purpose: they change only
when the pass's behavior is changed deliberately, by editing them by hand (or
regenerating with a one-off script) in the same commit that changes the
transform, with the diff reviewed as part of that change.

## Function IDs are a wire contract

The `<name>-<xxhash32(root-relative path)>[-<ordinal>]` ids baked into these
fixtures are not cosmetic output. They are baked into client bundles, server
manifests, rendered form-action urls and shared-cache keys, and a deployed
tab holds the previous build's ids across a deploy (solidjs/solid#3109 and
solidjs/solid#3120). A regeneration that changes any id is a protocol
change. It
re-points or orphans addresses another build already handed out, so it must
be reviewed as one and never waved through as fixture churn.

The name is the function's dotted binding path, such as `handlers.save` (the
`object-property` fixture) or `makeDraftSaver.submit` (`repeated-names`).
Anything that changes how the path is built changes ids. The ordinal suffix
is the last resort for two functions that share one path, and it is assigned
in the order the transform visits functions, which is post-bubble program
order. `directives-id-scheme.test.js` guards the derivation differentially,
with an independent hash implementation. It must never be updated in the
same breath as a fixture regeneration without understanding why both moved.
