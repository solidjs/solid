# @solidjs/compiler

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
- 7c551ae: Key server-function ids on identity instead of position (#3109). Production ids were `<xxhash32(path)>-<ordinal>`, so appending a server function to a file renumbered the others and every client holding the old numbering silently dispatched to different code with a 200. Ids are now `<name>-<xxhash32(root-relative path)>`, with a trailing ordinal only when the same descriptive name recurs within one file — appends, deletes, reorders, and body edits no longer move any address, and a removed or renamed function becomes a clean 404 instead of a wrong call. Development and production now share the exact same id format.
- 5230666: Fix hydration ids drifting after a reactive lone spread (#3105). A lone spread now passes its accessor straight to `spread()` on the client — no `mergeProps`, no memo, no hydration id — matching the server's existing pass-through fast path. The runtime resolves a function props source inside its own tracking scopes.
- e27dc29: `validate` now fails the compile instead of warning when a template's markup would be restructured by the browser's HTML parser (#3099). Once the validator fires the emitted positional walk is guaranteed not to match the browser-built DOM (crashed or silently misplaced bindings; desynced hydration under SSR), so warn-and-emit shipped certain breakage with the diagnostic buried in server logs. Errors now point at the offending JSX (code frame in Babel, line:col in the native compiler). `validate: false` remains the opt-out.

## 2.0.0-rc.4

### Minor Changes

- 5455320: Register call-shaped component bindings in the refresh (HMR) pass (#3090). A component produced by a factory call — `styled(...)`, an HOC, a tagged template — was never registered, and once a registered sibling made the module self-accept, `hot.accept()` disabled the very module invalidation its staleness relied on: the export went permanently stale, silently. Two compile-time admission gates fix this. A call-shaped top-level binding rendered as a JSX tag in its own module is proven a component and registers automatically (resolution is scope-aware — shadowing locals don't count). For export-only shapes with no in-module usage, the per-binding `@refresh component` pragma asserts it: `export const Badge = /* @refresh component */ styled.span\`...\``. Registered call bindings get the full treatment — location, granular signature, and dependencies, with same-module registered components excluded from the dependency set (edits propagate through the proxy chain; counting them would remount the consumer on every edit of the module). This is a deliberate native-first divergence from the frozen Babel-plugin reference.

### Patch Changes

- 3a2d214: The native compiler's JS loader accepts the `patchDriver` option and normalizes the boolean opt-in: the Rust core supports the option (dormant by default), but `validateOptions`' whitelist rejected it, and the napi wrapper mapping collapses `true` into `Wrapper::Default` — which `patch_driver` uniquely treats as disabled. The loader now whitelists the option and maps `true` to the default `"patchDriver"` import name so an explicit opt-in through `@solidjs/vite-plugin` reaches the native core.
- bfc834e: Prefer a local development build (`compiler.node`) over the installed `@solidjs/compiler-*` platform package when loading the native binding. The published package ships no local binary, so a local build can only mean development — but the loader tried the platform package first, which made the monorepo's own tests (locally and in CI) silently run against the last published release instead of the code under test. A present-but-unloadable local build now fails loudly instead of degrading to the published binary.
- 2f01f23: Module-level "use server" exports now register by value: the server build registers each export's evaluated terminal initializer whole, so server-side wrappers compose onto every call path — `export const getUser = withValidation(schema, fn)` applies the wrapper to HTTP dispatch and in-process SSR calls alike, and patterns like `withDelay(fn, 400)` work for server mocks. The client build always emits bare references, so wrappers, schemas, and helpers stay server-only by construction. The compiler never inspects the initializer's shape; `registerServerReference` now throws at module eval when handed a non-function, turning stray non-function exports into loud boot errors instead of dead references. Anonymous default expressions (`export default withDelay(...)`, `export default async () => ...`) get a synthesized binding and register too — previously they were silently dropped from both builds. Supersedes the unreleased wrapped-export compile error.
- 8d249c7: Patch-channel contract hardening from the stage-2 re-audit: ordinary `patchDriver` registrations unbind with their owner (entries no longer leak past unmount); merged transitions move their held-patch stash so no patch strands; the optimistic drain shares the normal drain's per-entry error isolation and boundary routing; accessor-bearing records are excluded at admission (scan-before-trust) and records that acquire accessors demote their patches to tracked effect fallbacks; writable projection arrays emit setter row ops at their fold-commit visibility moment; row-ops/slot registrations resolve chained backings to the ultimate owner; duplicate keys match occurrence-aware instead of first-wins; the production dev-token typo (`_DX_DEV_`) is fixed; `patchDriver: true` normalizes identically in Babel and the native loader, the option is typed in `TransformOptions`, and a `dom-patch` parity tier ratchets patch-mode output across both compilers (currently byte-identical on all fixtures).
- b534733: Scope-wrap bare function children in hydratable mode. A function child (`<main>{() => <App/>}</main>`, including via the `children` attribute) is a deferred hole at runtime, but it never classified as `dynamic`, so neither generate reserved an id scope for it — its owner ids drifted across async retry passes on the server and desynced from the client (the #2900 hydration-id-parity class). Both compilers now treat syntactic function expressions as scope-eligible alongside dynamic values, emitting `_$scope(...)` in the ssr generate and around the matching insert accessor in the dom generate. The native compiler also unwraps TS casts in the allocate-ids predicate, matching Babel (fixes a scope-emission desync for `{call() as any}` children).

## 2.0.0-rc.3

### Minor Changes

- 89a0531: Absorb the 0.50 expressions snapshot into this repo: lift compilers as `@solidjs/babel-plugin` and `@solidjs/compiler`, dump runtimes into `@solidjs/web` / `h` / `html` / `universal`. Origin: ryansolid/dom-expressions@e97e4290 (0.50.0-next.44).
- 89a0531: Collapse the expressions dump: drop the rxcore seam, flatten runtimes into package `src/`, delete `babel-preset-solid`, and publish compiler natives as `@solidjs/compiler-*`.

### Patch Changes

- 47a797e: Drop leftover DOM Expressions loader fallbacks and reframe the compiler and Babel plugin as Solid 2.0 packages. Node `transform()` now defaults `moduleName` to `@solidjs/web` and `builtIns` to the Solid control-flow set, matching `@solidjs/babel-plugin`. SSR leaves a sole component child unescaped (it is a value; the callee's insert sites escape) and only HTML-escapes mixed/fragment children and element holes. Local native builds remain usable when an in-repo platform-package stub has not been populated yet.
- 0d2810a: Fix Babel and native compiler lowering divergences around nested content, custom-element ownership, static attributes, namespaces, and conditional evaluation order.
- 2e52744: Module-level "use server" exports must be precisely the server functions: wrapping an export in a call expression (`export const x = GET(async () => ...)`) is now a compile error directing to the function-level directive. Replaces the short-lived wrapper-transplant behavior, which hoisted server-module code into the client build and never applied to HTTP dispatch anyway. Plain aliasing and separate declaration/export remain supported.

This package joined the SolidJS 2.0 monorepo at `2.0.0-rc.2`. Earlier releases lived in [DOM Expressions](https://github.com/ryansolid/dom-expressions).
