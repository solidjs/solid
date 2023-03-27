# solid-js

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
