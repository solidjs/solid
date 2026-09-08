# @solidjs/babel-plugin

## 2.0.0-rc.7

### Patch Changes

- ead7b1a: Keep hydration IDs aligned when an intrinsic element has a ref and one reactive spread.
- b3586e8: Validate document-shell templates in the document context (#3259). The `validate` pass round-trips templates through a body-context fragment parse, which strips `<html>`/`<head>`/`<body>` wrappers no matter how well-formed the markup — so once #3099 made validate failures compile errors, a root component owning the document shell failed to compile in plain client mode, and merely importing it (the jsdom component-test configuration) was fatal. Shell-rooted templates now parse as a document and the shell element is compared back — the analogue of the synthetic `<table>` wrap for table partials, in both the Babel plugin and the native compiler. Genuine restructuring (an implied `<head>`, flow content in `<head>`, a `<p>` split in `<body>`) still errors. Since `<template>` parsing flattens shells, actually client-creating one now throws a descriptive dev-mode error from `template()` pointing at `hydrate()` — the failure moved from every import to the one broken act.
- d601119: Remove the experimental patch channel and patch-mode list driver (always opt-in, never default). Graph-native regions own value delivery and the unified-For design owns list structure, so the channel's parallel delivery machinery is retired: `patch.ts`/`patch-driver.ts` deleted, the compiler-contract exports (`registerPatch`/`registerRowOps`/`registerSlotPatch`/`patchableRaw`, `patchDriver`/`rowProof`/`driveList`) removed, the `patchDriver` compiler option dropped from both compilers, the insert `$ll` seam stripped, and the write-side channel struct dieted to the single written-keys bound (`t.wk`) the core fold/notify paths actually use. Store-family app bundles reclaim up to ~900 B brotli; every measured tier shrinks.

## 2.0.0-rc.6

### Patch Changes

- 1e7fa73: Reject authored TSRX lazy destructuring in Solid while retaining deferred patterns generated for keyed loops and catch clauses.
- bbff5e0: Direct `value`/`checked` (and other stateful DOM property) bindings no longer overwrite pre-hydration user input during the hydration claim pass (#3182). Hydratable compiled output now routes locked DOM properties through `setProperty`, which skips writes on hydrating nodes and carries the `<select value>` microtask and input/textarea nullish special cases.
- cdbd584: Assign static `<select value>` values through the live DOM property so the matching option is selected consistently with reactive values.
- 5a1abb3: Compile TSRX loops with an index but no explicit key using Solid's non-keyed callback shape.
- 82868c6: Support recursive lazy destructuring, lazy arrow parameters, per-read defaults, computed keys, rest views, standalone assignments, accessor-backed keyed-loop and catch patterns, and JavaScript-correct writes and updates across the Babel and native TSRX frontends.
- 774aad5: Add compile-time scoped styles, CSS sidecar output, style class maps, and style refs to both TSRX frontends.
- c9c16cb: Add an experimental TSRX syntax frontend to both compilers. `.tsrx` sources (routed by filename with the new `syntax: "auto" | "jsx" | "tsrx"` option) desugar `@if`/`@else`, `@for … @empty`, `@switch`/`@case`, `@try`/`@catch`/`@pending`, `@{}` statement containers, and lazy destructuring (`&{}`/`&[]`) into the shared Solid JSX lowering, producing byte-identical output from both compilers. The Babel plugin loads the optional `@tsrx/core` peer dependency lazily; the native compiler ships the frontend behind the default-on `tsrx` cargo feature (statement containers in expression position are rejected with a structured diagnostic pending upstream oxc-tsrx support).

## 2.0.0-rc.5

### Patch Changes

- 320f1f5: Universal text is text (#3127). The DOM and SSR generators splice static
  text into an HTML template that a parser later unescapes, so they escape
  static values and keep JSX entities as written. The universal generator
  hands strings straight to the host — `createTextNode`, `setProp` — with no
  parser downstream, so the escaping rendered literally (`{"<b>"}` showed as
  `&lt;b>`) and entities never decoded (`&lt;` showed as `&lt;`), leaving no
  spelling that produced a literal `<` in static text under a custom
  renderer. Universal-rendered element children now pass static values
  through unescaped and decode JSX entities in text and string attributes,
  matching what component children and fragment text always did. The flag
  rides on the element, not the config, so `generate: "dynamic"` decides per
  renderer. Applied to both compilers; the attribute half closed ten pinned
  cross-mode parity divergences between them. Reported with the fix mapped
  out by @antoinevanwel.
- 5230666: Fix hydration ids drifting after a reactive lone spread (#3105). A lone spread now passes its accessor straight to `spread()` on the client — no `mergeProps`, no memo, no hydration id — matching the server's existing pass-through fast path. The runtime resolves a function props source inside its own tracking scopes.
- e27dc29: `validate` now fails the compile instead of warning when a template's markup would be restructured by the browser's HTML parser (#3099). Once the validator fires the emitted positional walk is guaranteed not to match the browser-built DOM (crashed or silently misplaced bindings; desynced hydration under SSR), so warn-and-emit shipped certain breakage with the diagnostic buried in server logs. Errors now point at the offending JSX (code frame in Babel, line:col in the native compiler). `validate: false` remains the opt-out.

## 2.0.0-rc.4

### Patch Changes

- 8d249c7: Patch-channel contract hardening from the stage-2 re-audit: ordinary `patchDriver` registrations unbind with their owner (entries no longer leak past unmount); merged transitions move their held-patch stash so no patch strands; the optimistic drain shares the normal drain's per-entry error isolation and boundary routing; accessor-bearing records are excluded at admission (scan-before-trust) and records that acquire accessors demote their patches to tracked effect fallbacks; writable projection arrays emit setter row ops at their fold-commit visibility moment; row-ops/slot registrations resolve chained backings to the ultimate owner; duplicate keys match occurrence-aware instead of first-wins; the production dev-token typo (`_DX_DEV_`) is fixed; `patchDriver: true` normalizes identically in Babel and the native loader, the option is typed in `TransformOptions`, and a `dom-patch` parity tier ratchets patch-mode output across both compilers (currently byte-identical on all fixtures).
- b534733: Scope-wrap bare function children in hydratable mode. A function child (`<main>{() => <App/>}</main>`, including via the `children` attribute) is a deferred hole at runtime, but it never classified as `dynamic`, so neither generate reserved an id scope for it — its owner ids drifted across async retry passes on the server and desynced from the client (the #2900 hydration-id-parity class). Both compilers now treat syntactic function expressions as scope-eligible alongside dynamic values, emitting `_$scope(...)` in the ssr generate and around the matching insert accessor in the dom generate. The native compiler also unwraps TS casts in the allocate-ids predicate, matching Babel (fixes a scope-emission desync for `{call() as any}` children).

## 2.0.0-rc.3

### Minor Changes

- 89a0531: Absorb the 0.50 expressions snapshot into this repo: lift compilers as `@solidjs/babel-plugin` and `@solidjs/compiler`, dump runtimes into `@solidjs/web` / `h` / `html` / `universal`. Origin: ryansolid/dom-expressions@e97e4290 (0.50.0-next.44).
- 89a0531: Collapse the expressions dump: drop the rxcore seam, flatten runtimes into package `src/`, delete `babel-preset-solid`, and publish compiler natives as `@solidjs/compiler-*`.

### Patch Changes

- 47a797e: Drop leftover DOM Expressions loader fallbacks and reframe the compiler and Babel plugin as Solid 2.0 packages. Node `transform()` now defaults `moduleName` to `@solidjs/web` and `builtIns` to the Solid control-flow set, matching `@solidjs/babel-plugin`. SSR leaves a sole component child unescaped (it is a value; the callee's insert sites escape) and only HTML-escapes mixed/fragment children and element holes. Local native builds remain usable when an in-repo platform-package stub has not been populated yet.
- 0d2810a: Fix Babel and native compiler lowering divergences around nested content, custom-element ownership, static attributes, namespaces, and conditional evaluation order.

The Babel compiler implementation joined the SolidJS 2.0 monorepo at `2.0.0-rc.2` under the temporary `@solidjs/babel-plugin-jsx` name. It adopted this syntax-neutral package name before the integration merged. Earlier releases lived in [DOM Expressions](https://github.com/ryansolid/dom-expressions).
