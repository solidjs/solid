# babel-preset-solid

## 2.0.0-experimental.8

### Patch Changes

- Updated dependencies [381d895]
  - solid-js@2.0.0-experimental.8

## 2.0.0-experimental.7

### Patch Changes

- Updated dependencies [53dcb14]
  - solid-js@2.0.0-experimental.7

## 2.0.0-experimental.6

### Patch Changes

- Updated dependencies [5f29f14]
  - solid-js@2.0.0-experimental.6

## 2.0.0-experimental.5

## 2.0.0-experimental.4

## 2.0.0-experimental.3

### Patch Changes

- c74106f: fix multi insert/removal, ssr wip, async signal render

## 2.0.0-experimental.2

### Patch Changes

- 874c256: fix input compilation, rebased dom-expressions

## 2.0.0-experimental.1

### Patch Changes

- 5c94067: update signals

## 2.0.0-experimental.0

### Major Changes

- 1da85a3: Update to new package layout, signals implementation, compiler

## 1.9.9

### Patch Changes

- c07887c: fix #2524 closedby types, fix regression inlining style/classList
- Updated dependencies [f59ee48]
- Updated dependencies [62c5a98]
- Updated dependencies [62c5a98]
- Updated dependencies [c07887c]
  - solid-js@1.9.9

## 1.9.8

### Patch Changes

- 2cd810f: compiler and jsx type updates
  - fix: ssr style undefined
  - fix: ssr double escaped array
  - fix: skip jsxImportSource skipping transform
  - fix: @once on style, classlist
  - JSX type updates
  - Update Universal Renderer Types

## 1.9.6

### Patch Changes

- 8356213: update compiler config, fix boolean attribute regression, update JSX types

## 1.9.5

### Patch Changes

- 35266c1: JSX type updates, preliminary MathML support, fix spread overescaping

## 1.9.3

### Patch Changes

- 9b70a15: validation fixes, type updates, ssr attribute fix

## 1.9.2

### Patch Changes

- 22aff14: update validation: smaller lib, opt out, better table handling
  add `on:` event types for native events

## 1.9.0

### Minor Changes

- 2a3a1980: update dom-expressions
  - Improved Custom Element/Shadow DOM traversal - @olivercoad
  - Better heuristic to determine when to importNode - @titoBouzout
  - handleEvent syntax to allow custom event properties when not delegated - @titoBouzout
  - support for bool: attribute namespace - @titoBouzout
  - add "is" as detection for custom element - @titoBouzout
  - fix missing exports in different envs - @trusktr
  - better hydration mismatch errors - @ryansolid
  - improved HTML validation of JSX partials - @titoBouzout

## 1.8.22

### Patch Changes

- 26128ec0: fix #2259 attr: in ssr, updates some types

## 1.8.19

### Patch Changes

- 816a5c61: fix #2209 processing parent before child value binding in select
- 424a31a3: optimize hydration keys

## 1.8.18

### Patch Changes

- 6693b56f: update TS, custom elements, and a lot compiler fixes
  fixes #2144, #2145, #2178, #2192

## 1.8.17

### Patch Changes

- 72c5381d: fix #2134, merge dom expressions fix #2136, fix #2137, fix #2110

## 1.8.16

### Patch Changes

- 071cd42f: fix #2100, fix #2102 - hydration errors due to over optimization

## 1.8.15

### Patch Changes

- 4ee461dc: improve template escaping, fragment hydration, SVG use types

## 1.8.12

### Patch Changes

- 85b26c36: fix #2041, fix #2043 - async renderer timing, numeric prop literals

## 1.8.9

### Patch Changes

- 80d4830f: fix #2016 value spread, smaller build output

## 1.8.8

### Patch Changes

- 968e2cc9: update seroval, fix #1972, fix #1980, fix #2002, support partial ALS

## 1.8.6

### Patch Changes

- 54e1aecf: update seroval, fix this, optimize star imports, fix #1952 hydration race condition

## 1.8.4

### Patch Changes

- cf0542a4: fix #1927, fix #1929, fix #1931, update storage API

## 1.8.2

### Patch Changes

- dd492c5e: fix #1917, fix #1918 error handling with serialization

## 1.8.0

### Minor Changes

- 2c087cbb: update to seroval streaming serializer, change ssr markers
- 2c087cbb: hydration perf improvement, fix #1849

### Patch Changes

- 2c087cbb: remove attribute quotes in template, batch serialization
- 2c087cbb: improved serialization/guards, fix #1413, fix #1796 hydration with lazy

## 1.8.0-beta.2

### Minor Changes

- e3a97d28: hydration perf improvement, fix #1849

## 1.8.0-beta.1

### Patch Changes

- f6d511db: remove attribute quotes in template, batch serialization

## 1.8.0-beta.0

### Minor Changes

- d8e0e8e8: update to seroval streaming serializer, change ssr markers

### Patch Changes

- bf09b838: improved serialization/guards, fix #1413, fix #1796 hydration with lazy

## 1.7.12

### Patch Changes

- 10ac07af: update jsx types, iife compiler optimization

## 1.7.7

### Patch Changes

- e660e5a3: add prettier code format in git-commit-hook

## 1.7.4

### Patch Changes

- 91110701: fix element/test mismatch issues #1684, #1697, #1707
  fix solid-ssr types
  add missing JSX types #1690
  fix firefox iframe #1688

## 1.7.3

### Patch Changes

- 655f0b7e: fix attr in ssr spread, fix static undefined classList values, fix #1666 directives in TTLs

## 1.7.2

### Patch Changes

- 699d88eb: More thorough close tag ommission fix

## 1.7.1

### Patch Changes

- d4087fe7: fix 1663: template element closing errors

## 1.7.0

### Minor Changes

- f7dc355f: Remove FunctionElement from JSX.Element types
- 940e5745: change to seroval serializer, better ssr fragment fixes
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 41ca6522: fixes around templates and hydration
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- a382c0c5: minify inline style, class
- 6a4fe46c: fix #1553 improper html entity encoding in literal expressions

## 1.7.0-beta.5

### Patch Changes

- a382c0c5: minify inline style, class

## 1.7.0-beta.4

### Patch Changes

- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes

## 1.7.0-beta.3

### Patch Changes

- 41ca6522: fixes around templates and hydration

## 1.7.0-beta.2

### Minor Changes

- 940e5745: change to seroval serializer, better ssr fragment fixes

## 1.7.0-beta.1

### Minor Changes

- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

## 1.7.0-beta.0

### Minor Changes

- f7dc355: Remove FunctionElement from JSX.Element types

### Patch Changes

- 6a4fe46: fix #1553 improper html entity encoding in literal expressions

## 1.6.16

### Patch Changes

- d10da016: Fix #1651 hydration markers introduced too early

## 1.6.13

### Patch Changes

- 60f8624d: fix #1596 ssr fragment text merge, fix #1599 ssr onCleanup

## 1.6.12

### Patch Changes

- 676ed331: docs: fix typos
- 081ca06c: fix #1553 html encoding for native strings on components
- 4fdec4f9: fix #1564, fix #1567 template literal bugs

## 1.6.10

### Patch Changes

- 7ab43a4: fix #1492 SSR Spread Breaks Hydration
  fix #1495 runWithOwner not clearing listener
  fix #1498 unrecoverable error in async batch

## 1.6.9

### Patch Changes

- a572c12: Streaming without a wrapper and compile time JSX validation

## 1.6.7

### Patch Changes

- 89baf12: fix boolean escaping, improve ssr performance

## 1.6.6

### Patch Changes

- 2119211: fix #1423 - inlined arrow functions in SSR and update rollup

## 1.6.3

### Patch Changes

- e95e95f: Bug fixes and testing changelog
