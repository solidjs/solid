# @solidjs/html

## 2.0.0-rc.2

### Patch Changes

- Updated dependencies [3878001]
- Updated dependencies [515ff56]
- Updated dependencies [3dbf12b]
- Updated dependencies [8a44c9e]
- Updated dependencies [e900893]
- Updated dependencies [ab0674c]
- Updated dependencies [e6d64f6]
  - @solidjs/web@2.0.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [8fec5a3]
- Updated dependencies [56ca647]
  - @solidjs/web@2.0.0-rc.1

## 2.0.0-rc.0

### Patch Changes

- @solidjs/web@2.0.0-rc.0

## 2.0.0-beta.34

### Patch Changes

- Updated dependencies [57194d8]
  - @solidjs/web@2.0.0-beta.34

## 2.0.0-beta.33

### Patch Changes

- Updated dependencies [f3accb3]
- Updated dependencies [8923ac6]
- Updated dependencies [3bcce84]
- Updated dependencies [dd163c5]
- Updated dependencies [a8d56dc]
- Updated dependencies [2722022]
- Updated dependencies [3740fde]
- Updated dependencies [09e2d3b]
- Updated dependencies [536dec5]
- Updated dependencies [45ef757]
- Updated dependencies [3b97432]
- Updated dependencies [38a8b51]
- Updated dependencies [da5646b]
- Updated dependencies [57611e8]
  - @solidjs/web@2.0.0-beta.33

## 2.0.0-beta.32

### Patch Changes

- Updated dependencies [b160a5f]
- Updated dependencies [311cc4e]
- Updated dependencies [e999401]
- Updated dependencies [c85b610]
- Updated dependencies [af97611]
- Updated dependencies [80970b7]
- Updated dependencies [dc7b5c2]
- Updated dependencies [8e148a8]
- Updated dependencies [595b9e9]
- Updated dependencies [687a993]
- Updated dependencies [202acdd]
- Updated dependencies [d657df1]
- Updated dependencies [43b5aaf]
- Updated dependencies [1c03436]
- Updated dependencies [bef6da9]
- Updated dependencies [0813a51]
- Updated dependencies [0813a51]
- Updated dependencies [0813a51]
  - @solidjs/web@2.0.0-beta.32

## 2.0.0-beta.31

### Patch Changes

- Updated dependencies [977b176]
- Updated dependencies [70d0da6]
- Updated dependencies [edb3e36]
- Updated dependencies [38e2e72]
- Updated dependencies [40b05e1]
- Updated dependencies [bcbe7e5]
- Updated dependencies [70d0da6]
- Updated dependencies [3ba6c86]
- Updated dependencies [ce60796]
  - @solidjs/web@2.0.0-beta.31

## 2.0.0-beta.30

### Patch Changes

- c3fa949: Update dom-expressions to 0.50.0-next.35. Pulls in: live slot props (args changes rebind the mounted slot instead of re-creating it), call-site handoff for dynamic's live mount when a server component changes arguments, streamed-fragment reveals routed through the runtime reveal policy (`_$HY.f`) so late-arriving fragments are held for their claimant instead of discarded, and the morph fix that restores displaced slot ranges into wholesale-inserted parents (regrown list rows no longer render blank after clearing a search).
- Updated dependencies [8c8b591]
- Updated dependencies [51f971b]
- Updated dependencies [9cbdb85]
- Updated dependencies [4533813]
- Updated dependencies
- Updated dependencies [c3fa949]
  - @solidjs/web@2.0.0-beta.30

## 2.0.0-beta.29

### Patch Changes

- 93ea8a1: Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
- Updated dependencies [43039c8]
- Updated dependencies [43039c8]
- Updated dependencies [43039c8]
- Updated dependencies [0271a9d]
- Updated dependencies [11beaf4]
- Updated dependencies [93ea8a1]
  - @solidjs/web@2.0.0-beta.29

## 2.0.0-beta.28

### Patch Changes

- Updated dependencies [8b20c1a]
- Updated dependencies
  - @solidjs/web@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- Updated dependencies [2a38f8a]
- Updated dependencies [76cb1aa]
- Updated dependencies [919a081]
- Updated dependencies [137e5ec]
  - @solidjs/web@2.0.0-beta.27

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
