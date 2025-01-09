# solid-js

## 1.9.4

### Patch Changes

- b93956f: fix escaping in resolution done outside of DOM Expressions
- 199dd69: fix reconcile null guard
- 7f9cd3d: lazy image, tagged template detection, security fixes
- 32aa744: Improve resolving arguments in createResource

## 1.9.3

### Patch Changes

- bb6ce8b: Reordering setter overloads
- 9b70a15: validation fixes, type updates, ssr attribute fix

## 1.9.2

### Patch Changes

- 22aff14: update validation: smaller lib, opt out, better table handling
  add `on:` event types for native events
- e2e2a03: Fix setter type compatibility with kobalte select and add tests

## 1.9.1

### Patch Changes

- fb67b687: fix anchor host interfering with event delegation
- 7ecf92d3: fix #2304 component props can be string, explicit imports in tests

## 1.9.0

### Minor Changes

- 4f8597dc: better handling of exports client/server
- 120bf06d: fix!: Remove browser field from package.json
- 2a3a1980: update dom-expressions
  - Improved Custom Element/Shadow DOM traversal - @olivercoad
  - Better heuristic to determine when to importNode - @titoBouzout
  - handleEvent syntax to allow custom event properties when not delegated - @titoBouzout
  - support for bool: attribute namespace - @titoBouzout
  - add "is" as detection for custom element - @titoBouzout
  - fix missing exports in different envs - @trusktr
  - better hydration mismatch errors - @ryansolid
  - improved HTML validation of JSX partials - @titoBouzout

### Patch Changes

- 80b09589: Improve signal setter type for code completion of string literal unions.
- 51bec61a: update TS to NodeNext

## 1.8.23

### Patch Changes

- bc20a4ce: update types, fix hydration cancel timing error, sync ssr script appending
- 9697c94b: jsdoc: Fix incorrect links of reactive utility `on`
- 9e192d7e: fix #2282: Add Check for Proxy support
- 379293d9: use correct hydration id in server lazy
- 73c00927: Fix missing code block end in `useTransition`'s jsdoc comment
- e4b2c668: fix missing disposal of nested transition nodes
- 94929afa: fix wrapping of object with `null` prototype

## 1.8.22

### Patch Changes

- f8ae663c: Fix broken links in Readme
- 19d0295f: fix stranded effects during hydration cancelation
- 26128ec0: fix #2259 attr: in ssr, updates some types

## 1.8.21

### Patch Changes

- a036a63a: shortcut hydrate call when hydration is done

## 1.8.20

### Patch Changes

- c8fe58e9: fix #2250 hydration error, fix lazy component loading, better hydration cancelation
- 80dd2769: fix #2236 improper shortcircuit in resource hydration

## 1.8.19

### Patch Changes

- 3fc015c2: track length in array helpers, fix mobx external source
- f909c1c1: fix #2228 - chained resources with initial values
- 816a5c61: fix #2209 processing parent before child value binding in select
- 424a31a3: optimize hydration keys

## 1.8.18

### Patch Changes

- 6693b56f: update TS, custom elements, and a lot compiler fixes
  fixes #2144, #2145, #2178, #2192
- a8c2a8f3: remove weird server resource hack, fix hydrated resource state

## 1.8.17

### Patch Changes

- 72c5381d: fix #2134, merge dom expressions fix #2136, fix #2137, fix #2110
- e065e475: fix #2135 ssr of top level fragments under Suspense

## 1.8.16

### Patch Changes

- 8de75a47: fix #2065 forward initial value to `on`
- 071cd42f: fix #2100, fix #2102 - hydration errors due to over optimization
- 3212f74d: Adjust some JSDocs

## 1.8.15

### Patch Changes

- 829af663: fix #2047 early interaction/multiple resources
- 4ee461dc: improve template escaping, fragment hydration, SVG use types

## 1.8.14

### Patch Changes

- 4b76be80: fix storage export in top-level package.json

## 1.8.13

### Patch Changes

- 3ac8210c: fix storage export

## 1.8.12

### Patch Changes

- aba5de08: fix #1746 class properties not working getters in createMutable
- 85b26c36: fix #2041, fix #2043 - async renderer timing, numeric prop literals

## 1.8.11

### Patch Changes

- 1ec67f15: fix #2028, fix #2029 revert spread value bypass, and guard multi-text

## 1.8.10

### Patch Changes

- 169d23b4: fix disposal timing when streaming

## 1.8.9

### Patch Changes

- 80d4830f: fix #2016 value spread, smaller build output
- 918586fb: fix #2017 object replacing array in `reconcile`
- 71bea784: fix #1971 order of merged properties
- b0862d39: fix #2014 html not replaced when resource resolves next `tick`
- cbc8d3ee: remove seroval plugins from build output

## 1.8.8

### Patch Changes

- 40b5d78d: chore(types): return mapped type for splitProps excluded `other` value
- 968e2cc9: update seroval, fix #1972, fix #1980, fix #2002, support partial ALS
- 292aba41: fix #1982 ErrorBoundary with ExternalSource
- 7e5667ab: fix #1998 Switch relying on order
- 8d2de12f: fix #1850 untrack in external source
- b887587a: fix #1973 array over object reconcile

## 1.8.7

### Patch Changes

- 22667bbc: fix: createSignal not found when bundled
- e09a3cc3: fix timing issue with deferStream

## 1.8.6

### Patch Changes

- 2b320376: Add types directory export for each package
- fb7f4bc1: fix #1950 leaking error tracking
- b092368c: feat(DEV): Add afterCreateSignal hook to DevHooks
- 54e1aecf: update seroval, fix this, optimize star imports, fix #1952 hydration race condition

## 1.8.5

### Patch Changes

- 80ca972f: fix `onHydrate` call being skipped

## 1.8.4

### Patch Changes

- cf0542a4: fix #1927, fix #1929, fix #1931, update storage API
- 3f3a3396: serialization error handling, experimental async storage

## 1.8.3

### Patch Changes

- 1f0226e1: fix #1917 for real this time

## 1.8.2

### Patch Changes

- b632dfd5: Add missing `indexArray` to server-side runtime.
- dd492c5e: fix #1917, fix #1918 error handling with serialization
- 4968fe26: Add `.js` extension to import

## 1.8.1

### Patch Changes

- 0b9b71aa: better errors for hydration

## 1.8.0

### Minor Changes

- 2c087cbb: update to seroval streaming serializer, change ssr markers
- 2c087cbb: hydration perf improvement, fix #1849

### Patch Changes

- 2c087cbb: remove attribute quotes in template, batch serialization
- 2c087cbb: improved serialization/guards, fix #1413, fix #1796 hydration with lazy
- 2c087cbb: fix: missing `has` property in `SharedConfig`
- 2c087cbb: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.2

### Minor Changes

- e3a97d28: hydration perf improvement, fix #1849

### Patch Changes

- d797a143: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.1

### Patch Changes

- f6d511db: remove attribute quotes in template, batch serialization
- af625dd3: fix: missing `has` property in `SharedConfig`

## 1.8.0-beta.0

### Minor Changes

- d8e0e8e8: update to seroval streaming serializer, change ssr markers

### Patch Changes

- bf09b838: improved serialization/guards, fix #1413, fix #1796 hydration with lazy

## 1.7.12

### Patch Changes

- 12eb1552: fix #1875 - mergeProps not handling undefined on SSR
- 13b1fa6e: fix #1883 initialize createDeferred with transition value
- 10ac07af: update jsx types, iife compiler optimization
- 8b49110b: Allow passing defer:boolean to `on`

## 1.7.11

### Patch Changes

- 26740b88: fix #1848 Suspense Default Context Non-Null

## 1.7.10

### Patch Changes

- 5ed448ae: Export `ContextProviderComponent`, `ResolvedChildren` and `ResolvedJSXElement` types
- 7dd1f413: fix .pipeTo signature to return promise
- c2008f02: Fix underscore property
- 792e7dea: fix #1821 improve context performance

## 1.7.9

### Patch Changes

- 44a2bf0b: fix #1814 incorrect typing embedding for h and html
- 6cd10c73: Changes how the Setter type was declared without actually functionally changing it, fixing the Setter type being assignable to any other Setter type; fixes #1818.

  Generically typed Setters must now non-null assert their parameter, i.e.

  ```diff
  function myCustomSignal<T>(v: T) {
    const [get, set] = createSignal<T>();
  -   const mySetter: Setter<T | undefined> = (v?) => set(v);
  +   const mySetter: Setter<T | undefined> = (v?) => set(v!);

    const [get, set] = createSignal<T>(v);
  -   const mySetter: Setter<T> = (v?) => set(v);
  +   const mySetter: Setter<T> = (v?) => set(v!);
  }
  ```

- 6c9879c9: fix in introspection in stores
- 039cf60d: update universal runtime readme
- 852f4c76: add missing link jsx types

## 1.7.8

### Patch Changes

- efd23186: fix #1780 invalid HTML comments
- 51074fab: remove optional chaining, reduce bundle size
- fe6f03f9: fix #1795 early effects running during async hydration

## 1.7.7

### Patch Changes

- c4cbfd3c: fix(Portal): reactive in children when pass signal directly
- 0100bd12: Propagate errors to parents when throwing errors in nested catchError
- 46e5e787: Improve type inference of `createSelector`.
- 8ba0e80a: Fix `mergeProps`.
- e660e5a3: add prettier code format in git-commit-hook
- 93d44d45: fix #1787 missing CJS types

## 1.7.6

### Patch Changes

- 83c99d51: fix #1739 resolved state of disabled resources
- f99dd044: Solid-Element: Add clarification on 'props' parameter in customElement function
- 88493691: apply reference optimization to mergeProps
- 514ef679: test: add tests to `splitProps`
- 20261537: fix #1735 web component instantiation before constructor
- 194f93c7: Improve performance in `splitProps` and `mergeProps`

## 1.7.5

### Patch Changes

- 5288cfa8: fix #1713, fix non-option jsx types
- 8852c199: test: add tests to `splitProps` and `mergeProps`

## 1.7.4

### Patch Changes

- 1b5ea076: perf: avoid unnecessary flat
- 91110701: fix element/test mismatch issues #1684, #1697, #1707
  fix solid-ssr types
  add missing JSX types #1690
  fix firefox iframe #1688

## 1.7.3

### Patch Changes

- 655f0b7e: fix attr in ssr spread, fix static undefined classList values, fix #1666 directives in TTLs
- 8ce2c47b: Portal fixes #1676, #1677

## 1.7.2

### Patch Changes

- 27994dc9: Another attempt at fixing skypack
- dfec6883: fix #1668 proto methods on store data nodes

## 1.7.1

### Patch Changes

- ba024813: fix ref timing in portals

## 1.7.0

### Minor Changes

- 503b6328: Add type narrowing non-keyed control flow
- 86c32279: always cast to errors when handled
- f7dc355f: Remove FunctionElement from JSX.Element types
- 940e5745: change to seroval serializer, better ssr fragment fixes
- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 41ca6522: fixes around templates and hydration
- 840933b8: fix #1653 portal bypasses Suspense
- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning
- 0dc8e365: Make non-null control flow assertion stricter by throwing
- 4929530b: Remove name generation of owners and signals
- 71c40af6: DEV: Minor additions and change the API of dev hooks
- 6a4fe46c: fix #1553 improper html entity encoding in literal expressions
- 5d671b89: Fix external source tests
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.5

### Patch Changes

- 0dc8e365: Make non-null control flow assertion stricter by throwing

## 1.7.0-beta.4

### Patch Changes

- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.3

### Patch Changes

- 41ca6522: fixes around templates and hydration

## 1.7.0-beta.2

### Minor Changes

- 940e5745: change to seroval serializer, better ssr fragment fixes

## 1.7.0-beta.1

### Minor Changes

- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning

## 1.7.0-beta.0

### Minor Changes

- 503b632: Add type narrowing non-keyed control flow
- 86c3227: always cast to errors when handled
- f7dc355: Remove FunctionElement from JSX.Element types

### Patch Changes

- 4929530: Remove name generation of owners and signals
- 71c40af: DEV: Minor additions and change the API of dev hooks
- e245736: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 6a4fe46: fix #1553 improper html entity encoding in literal expressions

## 1.6.16

### Patch Changes

- d10da016: Fix #1651 hydration markers introduced too early
- 620c7636: Switch test runner from Jest to Vitest

## 1.6.15

### Patch Changes

- e8448ebd: fix #1624 early fallback removal, add missing svg pathLength type
- da83ebda: defer ssr cleanup to next macrotask

## 1.6.14

### Patch Changes

- 6cceab2f: fix #1613 broken renderToString

## 1.6.13

### Patch Changes

- af20f00b: fix #1602 wrong resource state during SSR
- 60f8624d: fix #1596 ssr fragment text merge, fix #1599 ssr onCleanup

## 1.6.12

### Patch Changes

- e2888c77: Correct the type of `isServer` const to `boolean` from `false`.
- 676ed331: docs: fix typos
- b8a3ff13: fix #1586 error boundary called twice
- 1aff80c6: fix #1573 top level reconcile not merging
- 53db3f0f: fix fallback hydration
- 47d574a8: fix #1588: dynamic mount elements in Portals without recreation
- e245736f: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 61d1fe25: Export `isDev` const from solid-js/web for differentiating between dev/prod env.
- 4fdec4f9: fix #1564, fix #1567 template literal bugs

## 1.6.11

### Patch Changes

- bfbd002: Fixed the store setter's recursive fallback overload not terminating with non-numbers
- 1ecdea4: chore: export package.json
- 91d518a: fix: createResource should not ignores empty string throw
- 18e734d: Support null for detachedOwner in createRoot
- 12d458d: fix #1547, missing SVGPattern type
- 4aaa94b: Fix: swap KeyOf for MutableKeyOf in one of the SetStoreFunction overload
- c26f933: Add fast track for `untrack` in case of `null` listener
- 6fb3cd8: fix #1541: process errors at the end of synchronous execution
- c5b208c: fix #1522, errors stop future effects from running

## 1.6.10

### Patch Changes

- 1b32e63: Fix broken comments description link to solid docs
- dd879da: fix #1493 export DynamicProps
- d89e791: Add generic to onCleanup
- 695d99b: Export `EffectOptions` and `OnOptions` from main module
- d35a1ca: Fixed the return type of the `Symbol.observable` method of the `observable` in the generated `.d.ts`
- 7ab43a4: fix #1492 SSR Spread Breaks Hydration
  fix #1495 runWithOwner not clearing listener
  fix #1498 unrecoverable error in async batch

## 1.6.9

### Patch Changes

- a572c12: Streaming without a wrapper and compile time JSX validation
- 0ad9859: fix #1478 error infinite loop
- 12629a3: DEV: registerGraph `graph` property added to values

## 1.6.8

### Patch Changes

- 6db2d89: Fix #1461 - streaming broken due to reusing same resources for lazy dedupe

## 1.6.7

### Patch Changes

- c4ac14c: Format/Cleanup Types and code style
- 1384496: Fix unowned roots having owner in dev
- 1dbd5a9: stub out render and hydrate on server
- 368e508: make splitProps with dynamic source return proxies
- 54f3068: fix #1452 runWithOwner responsible for errors in its scope
- c8edacd: Fix lazy defined in components during SSR
- 89baf12: fix boolean escaping, improve ssr performance

## 1.6.6

### Patch Changes

- a603850: Export SignalOptions
- 2119211: fix #1423 - inlined arrow functions in SSR and update rollup
- 5a5a72d: Fix #1436 incorrectly missing proxy detection
- 5eb575a: fix: delete lazy contexts one by one as they are completed

## 1.6.5

### Patch Changes

- 50d1304: fix #1416 nulls in array reconcile
- ee71b16: fix #1410 - node 14 compatibility. Remove `||=` operator that isn't available on some legacy platforms.

## 1.6.4

### Patch Changes

- a42a5f6: memoize merging functions

## 1.6.3

### Patch Changes

- e95e95f: Bug fixes and testing changelog
