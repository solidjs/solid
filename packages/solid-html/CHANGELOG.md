# @solidjs/html

## 2.0.0-beta.26

### Patch Changes

- Updated dependencies [685d597]
- Updated dependencies [144801e]
- Updated dependencies [b29ca0a]
  - @solidjs/web@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- Updated dependencies [fc6cbaf]
- Updated dependencies [e654a59]
  - @solidjs/web@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- Updated dependencies [f9a1e63]
  - @solidjs/web@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- Updated dependencies [6c95f60]
  - @solidjs/web@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- 59fe5a7: Wire `claimElement` into the tagged-jsx runtime so anchors and forms with static `href`/`action` in `html` templates reach element-claim consumers (e.g. a router's link-state layer), matching compiled JSX. Dynamic and spread attributes were already claimed through the attribute-write recheck.
  - @solidjs/web@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- Updated dependencies [e88e2de]
- Updated dependencies [51de4f3]
  - @solidjs/web@2.0.0-beta.21

## 2.0.0-beta.20

### Patch Changes

- @solidjs/web@2.0.0-beta.20

## 2.0.0-beta.19

### Patch Changes

- Updated dependencies [32996e8]
- Updated dependencies [cded919]
  - @solidjs/web@2.0.0-beta.19

## 2.0.0-beta.18

### Patch Changes

- 8ca127d: Update dom-expressions to 0.50.0-next.19. Pulls in resolver manifests: the
  `manifest` option of `renderToString`/`renderToStream` now also accepts
  `{ resolve(key), resolveSync?(key) }` (or a bare function) as an alternative
  to a static manifest object, so dev servers can answer asset lookups from
  their live module graph. `resolve` may return a promise and may resolve CSS
  entries to inline-style descriptors (`{ id, content, attrs }`) for HMR
  adoption; `resolveSync` is exposed on the render context as
  `resolveAssetsSync` for sync consumers like `lazy()`'s `moduleUrl` getter.
  Also picks up an internal perf refactor of root-level insert cleanup
  (foreign-sibling detection via O(1) pointer checks).
- Updated dependencies [9b4dd76]
- Updated dependencies [9b4dd76]
- Updated dependencies [43c537a]
- Updated dependencies [4a1d997]
- Updated dependencies [8ca127d]
  - @solidjs/web@2.0.0-beta.18

## 2.0.0-beta.17

### Patch Changes

- @solidjs/web@2.0.0-beta.17

## 2.0.0-beta.16

### Patch Changes

- 5dd2949: Update dom-expressions to 0.50.0-next.15 under the new `@dom-expressions` npm scope (`@dom-expressions/runtime`, `@dom-expressions/babel-plugin-jsx`, `@dom-expressions/hyperscript`, `@dom-expressions/tagged-jsx`). Includes the upstream fix where awaited `renderToStream` now waits out blocked root holes (#2779) and the server `mergeProps` sourcing fix (#2815). `@solidjs/html`'s runtime shim follows the upstream SLD → Tagged JSX rename (`createTaggedJSXRuntime` / `TaggedJSXInstance`).
- f6a3540: Update dom-expressions to 0.50.0-next.16. Pulls in: per-slot insertion markers so adjacent expression slots no longer destroy nodes migrating between them (#2830), delegated events reaching outer roots across nested render roots (#2832), recovery from module preload failures during hydration plus manifest asset URL normalization (#2817), non-destructive style object diffing with explicit-undefined removal (#2828), preserved JS value semantics for wrapped `&&` conditions, and the hole id scope hydration fixes (#2801).
- Updated dependencies [5dd2949]
- Updated dependencies [be9a07a]
- Updated dependencies [06e45e8]
- Updated dependencies [098876d]
- Updated dependencies [f6a3540]
  - @solidjs/web@2.0.0-beta.16

## 2.0.0-beta.15

### Patch Changes

- Updated dependencies [a5d15f6]
- Updated dependencies [2c0a336]
  - @solidjs/web@2.0.0-beta.15

## 2.0.0-beta.14

### Patch Changes

- Updated dependencies [adbdab3]
- Updated dependencies [153e80f]
- Updated dependencies [adbdab3]
  - @solidjs/web@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- Updated dependencies [4404f9f]
- Updated dependencies [6fec663]
  - @solidjs/web@2.0.0-beta.13

## 2.0.0-beta.12

### Patch Changes

- @solidjs/web@2.0.0-beta.12

## 2.0.0-beta.11

### Patch Changes

- Updated dependencies [e16371f]
  - @solidjs/web@2.0.0-beta.11

## 2.0.0-beta.10

### Patch Changes

- Updated dependencies [59dd11f]
  - @solidjs/web@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- Updated dependencies [d8d8c95]
- Updated dependencies [d31b3c6]
  - @solidjs/web@2.0.0-beta.9

## 2.0.0-beta.8

### Patch Changes

- Updated dependencies [34c65b8]
  - @solidjs/web@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- @solidjs/web@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- @solidjs/web@2.0.0-beta.6

## 2.0.0-beta.5

### Patch Changes

- @solidjs/web@2.0.0-beta.5

## 2.0.0-beta.4

### Patch Changes

- Updated dependencies [2922dbb]
- Updated dependencies [8d3e093]
  - @solidjs/web@2.0.0-beta.4

## 2.0.0-beta.3

### Patch Changes

- @solidjs/web@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- Updated dependencies [8187065]
  - @solidjs/web@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- Updated dependencies [dadeeeb]
  - @solidjs/web@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- b1646a5: update signals
- Updated dependencies [2645436]
- Updated dependencies [b1646a5]
- Updated dependencies [c74106f]
- Updated dependencies [a4c833d]
- Updated dependencies [433eae5]
  - @solidjs/web@2.0.0-beta.0
