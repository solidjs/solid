# babel-preset-solid

## 2.0.0-rc.2

### Patch Changes

- 550b701: Bump @dom-expressions/babel-plugin-jsx to 0.50.0-next.44 — pairs the preset with the runtime's compiler-armed ssrSelectValues gate (compiled SSR output containing `<select value>` emits the arming marker; without it, select-value resolution is inert).
- Updated dependencies [db1fed6]
- Updated dependencies [3dbf12b]
- Updated dependencies [6692a2c]
- Updated dependencies [ccf2cb5]
- Updated dependencies [8a380d0]
  - solid-js@2.0.0-rc.2

## 2.0.0-rc.1

### Patch Changes

- Updated dependencies [3c68ab2]
- Updated dependencies [62e7883]
- Updated dependencies [4f84cd5]
- Updated dependencies [8366208]
- Updated dependencies [66accfb]
- Updated dependencies [56ca647]
- Updated dependencies [366da09]
- Updated dependencies [254daf8]
  - solid-js@2.0.0-rc.1

## 2.0.0-rc.0

### Patch Changes

- Updated dependencies [427dc18]
- Updated dependencies [667a020]
- Updated dependencies [d9050a8]
  - solid-js@2.0.0-rc.0

## 2.0.0-beta.34

### Patch Changes

- 57194d8: Update dom-expressions to 0.50.0-next.42 — the multi-root hydrate/islands fix. Pages that call `hydrate()` more than once (islands entry-clients, Astro-style one-render-per-island documents) hydrate correctly: each root re-installs its own captured registry/gather and re-arms `hydrating` across the deferred module-preload render instead of racing other roots on the shared live `sharedConfig`, and the root module map serializes renderId-scoped (`<renderId>_assets`, with a bare `_assets` fallback for the single-render islands shape) so per-island `renderToString` writes stop clobbering each other's preload maps. Whole-document renders are unchanged.
- Updated dependencies [f14e4ec]
  - solid-js@2.0.0-beta.34

## 2.0.0-beta.33

### Patch Changes

- 3b97432: Update dom-expressions to 0.50.0-next.41 — the published runtime for the DR-2/live-holes arc this branch builds on. The container tier lands (DR-2 case 3): reactive containers passed as slot args cross the slot border as their trace — an async iterable of a snapshot plus PatchOp batches — and materialize back into live read-only containers on the client, on both faces, with the `ContainerTracePlugin` riding the codec's default plugin set and its hooks living in a registered global so duplicated bundle copies share one protocol endpoint. Live markup holes reach the document face (Stage 4 producer half: one per-document engine, re-emissions on an eagerly-serialized `sc:live` record) and live attribute holes ship element-addressed via `data-lha` (Stage 3); document-face slot args get per-arg pending (a not-ready getter rides its own boundary instead of coarse-holding the occurrence) and mint-suppressed fill interiors, and scope-minting arg expressions latch instead of re-emitting (no duplicate projections, no never-ending responses). Server functions decouple the transport/codec from the codec-free registry surface (`server-functions/registry.js` + a late-bound RPC seam on `globalThis`), so an app with zero server functions stops shipping seroval and the fetch RPC client; results negotiate the JSON fast path with a lazily-loaded codec, and `isJSONSafe` survives cyclic and deeply nested values so negotiation failures stop masquerading as function errors (#566). Also picks up the serializer decode split (lazy readers load half the codec), Node16-CJS importable main-entry types, tree-shakable `ResponseEnvelope`, hydrating inserts keeping `current` honest about the DOM, and the streaming-SSR retry robustness fixes (branded retry wrappers ending O(N²) stack growth; real errors in retry passes fail the request, not the process).
- Updated dependencies [f3accb3]
- Updated dependencies [8923ac6]
- Updated dependencies [3bcce84]
- Updated dependencies [23657d2]
- Updated dependencies [a37611e]
- Updated dependencies [ba7560f]
- Updated dependencies [28f7bec]
- Updated dependencies [09e2d3b]
- Updated dependencies [913913a]
- Updated dependencies [ce8e46b]
- Updated dependencies [c320429]
- Updated dependencies [766ea30]
- Updated dependencies [536dec5]
- Updated dependencies [af1c71e]
- Updated dependencies [ab5f83c]
- Updated dependencies [d7f95bb]
  - solid-js@2.0.0-beta.33

## 2.0.0-beta.32

### Patch Changes

- 1c03436: Update dom-expressions to 0.50.0-next.40 — the published runtime for the freeze-gap public API this branch re-exports. The cookie codec lands as core platform-gap primitives (`serializeCookie`/`parseCookieHeader`, dependency-free percent-encoded round-trip; reads via `parseCookieHeader(event.request.headers.get("cookie"))`, writes via `event.response.headers.append("set-cookie", ...)`), with committed-stub write loudness (a post-commit `event.response` header write throws in dev, reports + no-ops in prod) and the multi-`Set-Cookie` portability guarantee (entry-by-entry `getSetCookie()` + append everywhere headers materialize, so multi-cookie responses survive Node/undici, workerd and Deno identically). The server-function handler's commit seam is public as `commitEventResponse(response, event?)` — the second of a handler's two exits, idempotent at handler edges because an already-committed stub passes the response through untouched. The serializer entry re-exports seroval's plugin-authoring API (`createPlugin`, `OpaqueReference`) from the runtime's own seroval instance so custom codec plugins are version-pinned by construction, and `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface. Also picks up the frames fixes: slot records wait for their `{$ref}` data args' arrival (async ref values compare by identity, so a re-sent pending ref re-suspends instead of freezing the previous value), rebind resets per-stream root affinity so a byte-identical shell still answers an address switch (#2977's stuck `isPending` re-arm), and the ambient hydration gather treats frame regions as opaque.
- Updated dependencies [af97611]
- Updated dependencies [dc7b5c2]
- Updated dependencies [b6071ba]
- Updated dependencies [3fd0499]
  - solid-js@2.0.0-beta.32

## 2.0.0-beta.31

### Patch Changes

- ce60796: Update dom-expressions to 0.50.0-next.37. Serialized server-component references now self-bootstrap the `_$SC` registry — each hydration script's first reference carries it as an idempotent expression — so no integration needs to splice a bootstrap script into `<head>`. The old head-open splice (vite-plugin-solid) put a script ahead of the authored head elements, where the hydration walk claimed it as the first walked child and drifted every positional claim in the head by one (metas claimed as title, title as link), warning in dev and silently drifting in production. The compiler also picks up the directive-DCE fix for type-only import remnants (solid-start #2273): pruning the last value specifier out of a mixed import now removes the whole declaration instead of leaving a bare server-module edge in the client bundle.
- Updated dependencies [a60b288]
- Updated dependencies [40b05e1]
- Updated dependencies [15b512f]
  - solid-js@2.0.0-beta.31

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

- 685d597: Bump dom-expressions to 0.50.0-next.30. Picks up the hydration fix for streamed `<Loading>` fallbacks (#2936): a pending boundary's placeholder scaffolding (`<template id="pl-X">` and its `<!--pl-X-->` end comment) is now excluded from hydration claim arrays, so a reactive text hole in the fallback adopts the server-rendered node and updates replace it in place instead of appending debris.
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

- cded919: Align `@dom-expressions/babel-plugin-jsx` with the rest of the toolchain at 0.50.0-next.22
- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
  - solid-js@2.0.0-beta.19

## 2.0.0-beta.18

### Patch Changes

- 4e33241: Align `@dom-expressions/babel-plugin-jsx` with the rest of the toolchain at 0.50.0-next.21
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

- adbdab3: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.12.

  This picks up root-owned delegated event targeting: `render()` and `hydrate()` own delegated listeners for their root containers while compiler-emitted `delegateEvents([...])` declares only the delegated event names needed by compiled JSX.

- 153e80f: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.13.

  This picks up the following runtime/compiler updates:
  - **Slot-owned node tagging** (resolves solidjs/solid#2030, solidjs/solid#2357): a single DOM node referenced from multiple JSX slots, or wrapped into a new slot's value between renders, no longer crashes `replaceChild` with "new child contains the parent" or vanishes during sibling-slot cleanup. Each runtime insertion now tags the inserted node with a per-slot symbol; destructive operations are gated on parent-and-tag ownership so foreign refs and migrated nodes are left alone. DOM renderer only.
  - **Init-throw scope cleanup**: when a user's render function (or anything inside `render()` / `hydrate()` init) throws, the partial render scope is now disposed instead of being orphaned, preventing leaked effects and stale subscriptions after a failed mount.
  - **Event-listener helper rename**: the compiler-emitted runtime helper that was previously `addEventListener` is now `addEvent`, avoiding the name collision with the native `EventTarget.addEventListener`. Compiler output reflects the new name automatically; runtime/userland code that imported `addEventListener` from `@solidjs/web` should switch to `addEvent`.
  - **JSX namespace cleanup**: previously tolerated `class:foo` and `style:foo` namespace syntax no longer gets special handling — both fall through to literal HTML attributes. Use `class={{ ... }}` for class toggles and `style={{ ... }}` for style properties.
  - **Static JSX marker**: the `/*@once*/` marker is removed from Solid's public JSX model. The compiler still recognizes a renamed `/*@static*/` marker for low-level cases (e.g. compiler internals), but Solid 2.0 guidance is to use normal reactive JSX, `defaultValue` / `defaultChecked` for DOM initial state, and `untrack` for intentional one-time JavaScript reads — not a marker-based replacement.

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
