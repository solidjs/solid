# @solidjs/universal

## 2.0.0-beta.30

### Patch Changes

- c3fa949: Update dom-expressions to 0.50.0-next.35. Pulls in: live slot props (args changes rebind the mounted slot instead of re-creating it), call-site handoff for dynamic's live mount when a server component changes arguments, streamed-fragment reveals routed through the runtime reveal policy (`_$HY.f`) so late-arriving fragments are held for their claimant instead of discarded, and the morph fix that restores displaced slot ranges into wholesale-inserted parents (regrown list rows no longer render blank after clearing a search).
- Updated dependencies [51f971b]
- Updated dependencies [40af691]
- Updated dependencies [c3fa949]
  - solid-js@2.0.0-beta.30

## 2.0.0-beta.29

### Patch Changes

- 93ea8a1: Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
- Updated dependencies [11beaf4]
- Updated dependencies [93ea8a1]
  - solid-js@2.0.0-beta.29

## 2.0.0-beta.28

### Patch Changes

- solid-js@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- Updated dependencies [76cb1aa]
- Updated dependencies [17b0afb]
  - solid-js@2.0.0-beta.27

## 2.0.0-beta.26

### Patch Changes

- solid-js@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- solid-js@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- solid-js@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- Updated dependencies [6c95f60]
  - solid-js@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- solid-js@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- Updated dependencies [b1b2f82]
- Updated dependencies [a79f974]
- Updated dependencies [e3d5fed]
- Updated dependencies [c4fad7a]
  - solid-js@2.0.0-beta.21

## 2.0.0-beta.20

### Patch Changes

- Updated dependencies [729a5e1]
- Updated dependencies [ff5c321]
- Updated dependencies [bbc5ac8]
- Updated dependencies [a24a4de]
- Updated dependencies [c7bb2c8]
- Updated dependencies [9f27cdf]
  - solid-js@2.0.0-beta.20

## 2.0.0-beta.19

### Patch Changes

- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
  - solid-js@2.0.0-beta.19

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
- Updated dependencies [500d484]
- Updated dependencies [7d21226]
- Updated dependencies [1b94264]
- Updated dependencies [9b4dd76]
- Updated dependencies [1561c7e]
- Updated dependencies [4e67d45]
- Updated dependencies [8ca127d]
  - solid-js@2.0.0-beta.18

## 2.0.0-beta.17

### Patch Changes

- Updated dependencies [928ba28]
- Updated dependencies [25a5685]
- Updated dependencies [fe9ed90]
- Updated dependencies [4cc6113]
- Updated dependencies [9b883e0]
  - solid-js@2.0.0-beta.17

## 2.0.0-beta.16

### Patch Changes

- 5dd2949: Update dom-expressions to 0.50.0-next.15 under the new `@dom-expressions` npm scope (`@dom-expressions/runtime`, `@dom-expressions/babel-plugin-jsx`, `@dom-expressions/hyperscript`, `@dom-expressions/tagged-jsx`). Includes the upstream fix where awaited `renderToStream` now waits out blocked root holes (#2779) and the server `mergeProps` sourcing fix (#2815). `@solidjs/html`'s runtime shim follows the upstream SLD → Tagged JSX rename (`createTaggedJSXRuntime` / `TaggedJSXInstance`).
- f6a3540: Update dom-expressions to 0.50.0-next.16. Pulls in: per-slot insertion markers so adjacent expression slots no longer destroy nodes migrating between them (#2830), delegated events reaching outer roots across nested render roots (#2832), recovery from module preload failures during hydration plus manifest asset URL normalization (#2817), non-destructive style object diffing with explicit-undefined removal (#2828), preserved JS value semantics for wrapped `&&` conditions, and the hole id scope hydration fixes (#2801).
- Updated dependencies [4b5272f]
- Updated dependencies [f8f992d]
- Updated dependencies [f658824]
- Updated dependencies [088f97e]
- Updated dependencies [4608539]
- Updated dependencies [f14e3e3]
- Updated dependencies [8b6c298]
- Updated dependencies [5bc9080]
- Updated dependencies [0e8672a]
- Updated dependencies [1458907]
- Updated dependencies [098876d]
- Updated dependencies [f6a3540]
  - solid-js@2.0.0-beta.16

## 2.0.0-beta.15

### Patch Changes

- Updated dependencies [8402421]
- Updated dependencies [f083220]
- Updated dependencies [98a7385]
- Updated dependencies [c943c5c]
- Updated dependencies [4f14a34]
- Updated dependencies [bff4c21]
- Updated dependencies [52255dc]
  - solid-js@2.0.0-beta.15

## 2.0.0-beta.14

### Patch Changes

- Updated dependencies
  - solid-js@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- Updated dependencies [157dfe2]
- Updated dependencies [4404f9f]
- Updated dependencies [6fec663]
  - solid-js@2.0.0-beta.13

## 2.0.0-beta.12

### Patch Changes

- Updated dependencies [b964dc7]
- Updated dependencies [0a7c278]
- Updated dependencies [1c5cc7c]
- Updated dependencies [1833f14]
- Updated dependencies [12f15a2]
  - solid-js@2.0.0-beta.12

## 2.0.0-beta.11

### Patch Changes

- Updated dependencies [95ca987]
- Updated dependencies [cb04b8e]
- Updated dependencies [b0db6c9]
- Updated dependencies [47c0e6f]
- Updated dependencies [263be3f]
- Updated dependencies [59d84ba]
- Updated dependencies [80b4e8d]
- Updated dependencies [d2529e3]
- Updated dependencies [80b4e8d]
- Updated dependencies [80b4e8d]
  - solid-js@2.0.0-beta.11

## 2.0.0-beta.10

### Patch Changes

- Updated dependencies [59dd11f]
- Updated dependencies [e841f8c]
- Updated dependencies [a93a216]
- Updated dependencies [cf92b55]
- Updated dependencies [2a7c6a5]
  - solid-js@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- d31b3c6: Simplify `render` wrappers and give custom universal renderers deferred top-level mount.

  `@solidjs/web`'s `render()` is now a thin wrapper around `dom-expressions`' `render` — it threads `{ insertOptions: { schedule: true } }` through the new `insertOptions` seam (added in `dom-expressions@0.50.0-next.2`), scopes the `ASYNC_OUTSIDE_LOADING_BOUNDARY` dev window, and tail-flushes the queue. No behavioral change for end users; the local `createRoot` / `flatten` / `insert` plumbing that was inlined in the previous commit has moved back into `dom-expressions`.

  `@solidjs/universal` is no longer a pure re-export of `dom-expressions/src/universal.js`. It wraps `createRenderer` so the returned `render(code, element)` does `createRoot` + `insert(..., { schedule: true })` + tail `flush()`. Every custom universal renderer now inherits the same permissive top-level async semantics as `@solidjs/web`, without having to rewrite its own `render`.

- Updated dependencies [9015b12]
- Updated dependencies [fb2e43b]
- Updated dependencies [845b6bb]
- Updated dependencies [23f7550]
- Updated dependencies [8b9c5bf]
- Updated dependencies [9015b12]
- Updated dependencies [c324d2c]
- Updated dependencies [4620612]
- Updated dependencies [f7d5af6]
- Updated dependencies [c324d2c]
- Updated dependencies [c324d2c]
- Updated dependencies [3ee92f3]
- Updated dependencies [0ef177e]
- Updated dependencies [9015b12]
  - solid-js@2.0.0-beta.9

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
