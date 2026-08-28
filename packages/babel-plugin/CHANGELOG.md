# @solidjs/babel-plugin

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
