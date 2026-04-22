# babel-preset-solid

## 2.0.0-beta.8

### Patch Changes

- Updated dependencies [34c65b8]
- Updated dependencies [ed2079f]
- Updated dependencies [2597a4a]
- Updated dependencies [00c3f78]
- Updated dependencies [d46928f]
- Updated dependencies [000da61]
- Updated dependencies [2e4a924]
- Updated dependencies [ac0067a]
- Updated dependencies [ac0067a]
  - solid-js@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [76b11b2]
- Updated dependencies [5869c94]
- Updated dependencies [3242e50]
- Updated dependencies [f18780e]
- Updated dependencies [ea7f892]
- Updated dependencies [beb419e]
- Updated dependencies [bd563d0]
- Updated dependencies [e855fcb]
- Updated dependencies [5086c21]
- Updated dependencies [8511fc1]
  - solid-js@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [df3f514]
- Updated dependencies [74ea248]
- Updated dependencies [4a954e7]
- Updated dependencies [159d204]
- Updated dependencies [6a87fb2]
  - solid-js@2.0.0-beta.6

## 2.0.0-beta.5

### Patch Changes

- Updated dependencies [03e2cca]
- Updated dependencies [8ef7ece]
- Updated dependencies [8db4de8]
- Updated dependencies [e6177b4]
- Updated dependencies [8ef7ece]
- Updated dependencies [009d3de]
- Updated dependencies [3bd00d2]
- Updated dependencies [3eed9c1]
- Updated dependencies [d037842]
- Updated dependencies [6b4af47]
  - solid-js@2.0.0-beta.5

## 2.0.0-beta.4

### Patch Changes

- Updated dependencies [681d6a5]
- Updated dependencies [2922dbb]
  - solid-js@2.0.0-beta.4

## 2.0.0-beta.3

### Patch Changes

- Updated dependencies [284738e]
- Updated dependencies [5c961fa]
- Updated dependencies [284738e]
- Updated dependencies [284738e]
- Updated dependencies [26ea296]
  - solid-js@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
  - solid-js@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- Updated dependencies [dadeeeb]
  - solid-js@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- 874c256: fix input compilation, rebased dom-expressions
- b1646a5: update signals
- c74106f: fix multi insert/removal, ssr wip, async signal render
- Updated dependencies [512fd5e]
- Updated dependencies [dea16f3]
- Updated dependencies [15dc3c6]
- Updated dependencies [c3e5e78]
- Updated dependencies [874c256]
- Updated dependencies [4cab248]
- Updated dependencies [1122d74]
- Updated dependencies [c78ec9f]
- Updated dependencies [9788bad]
- Updated dependencies [21fff6f]
- Updated dependencies [2645436]
- Updated dependencies [60f2922]
- Updated dependencies [433eae5]
- Updated dependencies [b1646a5]
- Updated dependencies [e8d8403]
- Updated dependencies
- Updated dependencies [1a1a5d4]
- Updated dependencies [5f29f14]
- Updated dependencies [85aa54f]
- Updated dependencies [433eae5]
- Updated dependencies [c74106f]
- Updated dependencies [f4b0956]
- Updated dependencies [3e3c875]
- Updated dependencies [75eebc2]
- Updated dependencies [568ed6f]
- Updated dependencies [75eebc2]
- Updated dependencies [d1e6e29]
- Updated dependencies [a4c833d]
- Updated dependencies [84c80f9]
- Updated dependencies [381d895]
- Updated dependencies [fbbd7e3]
- Updated dependencies [53dcb14]
- Updated dependencies [dea16f3]
  - solid-js@2.0.0-beta.0

## 1.9.12

### Patch Changes

- c58983d: fix SSR output including `bool:` attribute serialization and escaping for logical and child expressions
- Updated dependencies [51b0797]
- Updated dependencies [6b0c4ee]
- Updated dependencies [51cce75]
- Updated dependencies [c58983d]
  - solid-js@1.9.12

## 1.9.10

### Patch Changes

- 6c92555: Update dom-expressions, seroval plugins, optional chaining ref, style optimization
- Updated dependencies [2270ae9]
- Updated dependencies [94d87f1]
- Updated dependencies [3114302]
- Updated dependencies [6c92555]
  - solid-js@1.9.10

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
