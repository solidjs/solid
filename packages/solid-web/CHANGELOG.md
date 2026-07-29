# @solidjs/web

## 2.0.0-beta.28

### Patch Changes

- 8b20c1a: Export a `Slot<P>` type from `@solidjs/web/frames` for typing server-component client positions.

  A server component describes its client positions as props the server renders where client-owned markup belongs. Typing those by hand meant restating the client component's shape and adding `$key` to it, which pushed apps toward wrapper types per component. `Slot<P>` takes the client component's own props and adds the optional `$key`, so the hole is described with the same type that fills it:

  ```ts
  type ToggleSlot = Slot<ComponentProps<typeof Toggle>>;
  ```

  The type is exported from both halves of the subpath — server components are authored in universal code, so it has to resolve under the browser condition too. It is type-only, so nothing crosses into the client bundle.

- Update `@dom-expressions/runtime` to 0.50.0-next.33. The server function handler now pre-digests the single-flight outcome before invoking `collectFlightData` — `targetUrl` (the URL the client will show after the mutation, origin-checked), `revalidateKeys` (the outcome's `X-Revalidate` keys, split), and `foldedHeaders` (request headers with the mutation's `Set-Cookie` effects applied) arrive on the outcome, so integrations only supply the data strategy. Raw body-carrying `Response` values skip collection entirely. Adds `decodeResponsePayload` beside `decodeResponse` for splitting the single-flight envelope on manually opted-in calls.
  - solid-js@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- 2a38f8a: Adopt @dom-expressions/runtime 0.50.0-next.32, which absorbs the router-agnostic wire protocols from Solid Router. Through the `server-functions` entries this adds: the flash cookie protocol (`FLASH_COOKIE`/`hasFlashCookie`/`clearFlashCookie` on both entries; `encodeFlashCookie`/`decodeFlashCookie` and the `FlashSubmission` shape on the server entry), `foldSetCookies` for replaying a mutation's `Set-Cookie` deltas onto request headers, `REVALIDATE_HEADER` as a named export next to the response helpers that write it, and `createNoJSHandler` — which `handleServerFunctionRequest` now applies to browser form posts by default, so form posts made without the client runtime redirect back with the outcome flashed instead of answering with a serialized payload (configure or disable via `handleNoJS`). Also fixes a thrown bodyless `Response` being nulled before reaching `handleNoJS`, which silently dropped the redirect target.
- 76cb1aa: Fix `dynamic()` and `lazy()` gating the SSR shell flush instead of suspending into their boundary

  Both registered their source promise as a renderer-blocking promise, so the document's first flush waited on it. An enclosing `<Loading>` never rendered its fallback and a slow source stalled the entire document — a 500ms server component pushed the shell from 27ms to 527ms with nothing streamed, and an un-preloaded `lazy()` held the shell for the full module load.

  The pending read now simply suspends, letting the nearest boundary own it and stream the content in behind its placeholder. Where there is no boundary to defer to the read becomes a root hole and the renderer blocks the shell on it as before, so a bare `dynamic()` or `lazy()` still resolves inline. Near-instant sources and preloaded modules continue to inline with no fallback flash.

  For `lazy()` this does not affect asset ordering: `assetsPending` gates the render memo separately, so a fragment still cannot flush before its styles and module map are registered.

  Also adds an internal `serialize: false` option to the server `createMemo`, which keeps a value out of the hydration payload while the subtree still hydrates normally (unlike `NoHydrateContext`, which opts the subtree out entirely and suppresses the id allocation needed for client parity). It carries the contract that the client recomputes the value. This lets the server `dynamic()` drop its hand-rolled promise tracking and mirror the client's two-memo shape, since its resolved value is a component function that must never cross the wire.

- 919a081: Frames: gather hydration-claim registries without descending into nested regions

  `claimRender` built each occurrence's registry with `querySelectorAll("*[_hk]")` over its existing nodes, which descends into nested `<dx-frame>` regions — content that belongs to nested occurrences running their own claims. On a deeply nested adopted tree (an HN comment thread) every level re-collected its entire subtree, making registry gathering O(nodes × depth). The registry is now gathered by a walk that treats region elements as opaque, so the total work across all claims is linear in the tree.

- 137e5ec: Adopt server-component boundaries that arrive after the shell flush. A boundary was looked up in a one-time `[data-fid]` snapshot of `document.body`, and a miss immediately mounted a fresh client frame. That decision is unrecoverable, and it was wrong for every server component whose source settles after the shell flush: the producer emits the resolver script (`$R[n](…, self._$SC.r(id))`) ahead of the markup, so the placeholder mounts while the boundary element is still in flight — on a live feed the shell flushes with a few hundred bytes of body, and the markup follows after `</html>` inside the reveal template. The server's markup then landed owned by nothing, visible but inert, while the stream drove an element outside the page: the boundary never updated again, so every navigation into it fetched correctly and changed nothing, and route changes left the orphan behind, stacking the old route's DOM under the new one.

  A miss while the document is still streaming now means "not yet" rather than "never": the boundary suspends — the enclosing `<Loading>` goes on showing the server's fallback, which is what the page is already displaying — and adopts the element when the reveal delivers it. Reveals are picked up from `_$HY.fe`, which the streaming layer already calls on every swap, wrapped rather than overwritten so other consumers keep working; when the producer passes the revealed fragment's parent, the rescan is scoped to what just arrived. Client-only boots are unchanged (no `_$HY`, or the document is done → mount fresh), and the index now skips nested region ids, which keeps it at a handful of entries instead of one per region.

- Updated dependencies [76cb1aa]
- Updated dependencies [17b0afb]
  - solid-js@2.0.0-beta.27

## 2.0.0-beta.26

### Patch Changes

- 685d597: Bump dom-expressions to 0.50.0-next.30. Picks up the hydration fix for streamed `<Loading>` fallbacks (#2936): a pending boundary's placeholder scaffolding (`<template id="pl-X">` and its `<!--pl-X-->` end comment) is now excluded from hydration claim arrays, so a reactive text hole in the fallback adopts the server-rendered node and updates replace it in place instead of appending debris.
- 144801e: Fix frames types build on fresh installs: map bare `@solidjs/web` in `frames/tsconfig.build.json` paths (alongside the existing server-functions/client mapping). The insert-dedup change imports `insert` from `@solidjs/web`, which fails under NodeNext without the package self-link that only local `link` checkouts have.
- b29ca0a: Adopt the element-based frame seams from `@dom-expressions/runtime`: a server-component boundary is now a client-owned `<dx-frame>` element rather than a branded comment-marker range. `boundaryComponent` uses `createFrameElement` and returns the element (which `insert` places natively in any position, fixing the array/fragment crash class), and `documentBoundary` adopts the SSR'd boundary element via `createFrame(el, { adopt: true })`, located by a single `[data-fid]` attribute query instead of a comment-pair TreeWalk. The occlusion drain, hydration-claim scoping, and stable-component transport policy are unchanged. Requires `@dom-expressions/runtime` with the element seam (`createFrameElement`/`FRAME_ID_ATTR`, `createFrame` adopt option); `createFrameInsertable`/`adoptFrameRange` are gone.
  - solid-js@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- fc6cbaf: Fix the packaged frames client shipping without its transport half. `frames/dist/client.js` bundled a PRIVATE copy of the server-function client; because the frames entry never calls that copy's readers, rollup concluded the `configureServerFunctionsClient({ responseHandler: ... })` write inside `installServerComponents` was unobservable and tree-shook the entire call out of the artifact — published beta.23/24 could adopt document boundaries but never installed the frame-stream transport (t=0 intercept, refetch morphs, fresh boundaries all dead). The private copy was a correctness hazard even without the shake: its module-scoped config would never be seen by the compiled reference proxies, which call through `@solidjs/web/server-functions`. The frames client now imports `@solidjs/web/server-functions/client` and keeps it external, so the dist configures the same built instance the proxies resolve to, and a build-time assertion (`assertFramesClientTransport` in rollup.config.js) fails the frames build if the transport wiring ever drops out of the emitted chunk again.
- e654a59: Fix the frames types build: `types:copy-frames` expected compiled declarations at `frames/types/` that no step ever generated, breaking `pnpm types` (and CI builds). Frames declarations now compile via a dedicated `frames/tsconfig.build.json` (mirroring the storage submodule), and the published `types/frames` facades get their bundled `@dom-expressions/runtime` specifiers rewritten to relative paths so they resolve against the runtime d.ts files shipped alongside them.
  - solid-js@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- f9a1e63: Frames: hydration claims are now gated to the adoption attach
  (`ctx.adopted`) — a stream-driven re-call of an adopted occurrence renders
  for real instead of claiming, so content the re-call displaces (moved-out
  `{$frame}` region ranges) is re-placed rather than silently dropped
  (dom-expressions#547).
  - solid-js@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- 6c95f60: **Experimental — `@solidjs/web/frames`: server components.** Shipping as
  an experimental preview alongside Solid 2.0: the subpath, its API, and the
  underlying wire format are NOT covered by 2.0's stability guarantees and
  may change between prereleases. Expect a separate stabilization
  announcement.

  There is deliberately no new component API. A server component is a
  function returned from a server function, and `dynamic` is how you use it:

  ```tsx
  const getStory = /* "use server" fn returning (props) => JSX */;

  function StoryPage(props) {
    const Story = dynamic(() => getStory(props.storyId));
    return (
      <Story comment={(p) => <CollapsibleComment cid={p.cid}>{p.children}</CollapsibleComment>}>
        <ShareBar />
      </Story>
    );
  }
  ```

  Server content streams as HTML and morphs in place across refetches —
  client components inside it (and their state: focus, inputs, toggles)
  survive navigation. Nothing ships twice: no serialized component trees, no
  hydration data for server content, and at t = 0 the server-rendered
  document is adopted (zero requests at boot; wrappers claim their
  server-rendered DOM by hydration key). Content the client didn't render at
  SSR (e.g. collapsed threads) ships once as data and mounts later with zero
  network.

  Surface:
  - client: `installServerComponents()` (call once in the client entry),
    `getFrameHost`, and the frame/transport primitives routers build on
    (`applyFrameResponse`, `FRAME_APPLIED_EVENT`, `adoptFrameRange`,
    `createServerComponentHandler`). Server-component anchors/forms
    participate in the element-claim contract, so router link state works on
    server content unchanged.
  - server (`@solidjs/web/frames/server`): `frameTransformResult` /
    `frameTransformDirectResult` — install on the server-function handler
    and document SSR respectively — plus `renderServerComponent`,
    `renderToFrameStream`, `serverComponentResponse`, `createFrameSink`, and
    the document-shell pieces (`ServerComponentPlugin`,
    `SERVER_COMPONENT_BOOTSTRAP`).

  See `examples/hackernews` (and its SSR-SPA twin, the measured comparison)
  and dom-expressions' `docs/server-components.md`.

- Updated dependencies [6c95f60]
  - solid-js@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- solid-js@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- e88e2de: Bridge the settled server-function extension surface through `@solidjs/web/server-functions`: `GET(fn)`, the declaration-metadata channel (`withMeta`, `getServerFunctionMetadata`, `isServerFunction`), and the `prepareRequest` client hook — and drop the legacy per-reference `.GET`/`.withOptions` escape hatches (beta, no compatibility shims).
  - **`GET(fn)`** declares a server function callable over HTTP GET (arguments codec-encoded in the query string, cacheable URLs). Both environment halves export it: the browser build's returns the GET-transport callable, the server build's is identity-flavored (SSR stays in-process) and records the declaration so the handler answers 405 when the request method contradicts it. Function-level `"use server"` directives round-trip the wrapper call, so `export const getUser = GET(async (id) => { "use server"; ... })` needs no compiler support.
  - **`withMeta(fn, meta)`** attaches arbitrary user-declared transport metadata to a reference through the same channel and returns it, shallow-merging later writes; it composes with `GET` in either order. `getServerFunctionMetadata(fn)` reads the merged bag and `isServerFunction(fn)` is the structural guard — both detect by a registered-symbol brand, so they work across the separately bundled client/server entries; routers use them instead of property sniffing.
  - **`prepareRequest(init, { id, meta })`** on `configureServerFunctionsClient` (with the exported `PrepareRequestHook` type) runs before every outgoing server-function fetch — session-dynamic transport policy like OAuth bearer tokens, keyed per-function through `withMeta` declarations rather than id comparisons.
  - References keep the callable, `url`, and now expose `id` on both sides; `.GET` and `.withOptions` are gone — session-dynamic uses go through `prepareRequest`, and single-flight opt-in is already automatic via `subscribeFlightData`.

- 51de4f3: Bridge the single-flight mutation protocol through `@solidjs/web/server-functions`.

  Pulls in dom-expressions' generic single-flight protocol: on the server, `configureServerFunctionsServer({ collectFlightData })` (or the per-handler `collectFlightData` option on `handleServerFunctionRequest`) registers the hook that produces a data payload from a call's outcome — the handler folds it into the response as the standardized `{ value, data }` payload under the `X-Single-Flight` header. On the client, `subscribeFlightData(consumer)` registers the consumer the fetch transport delivers `data` to (with the response as envelope context — redirect location, revalidation keys) before returning `value` to the caller; the registration is universal, exported from both halves of the subpath, since routers are universal code. The flight-data types (`SingleFlightPayload`, `FlightDataConsumer`, `FlightDataContext`, `CollectFlightDataHook`, `ServerFunctionOutcome`) and `SINGLE_FLIGHT_HEADER` ride the copied type surface. Without a hook or consumer, behavior is byte-identical to before.

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

- 32996e8: Add the server function runtime ABI as `@solidjs/web/server-functions` and the response helpers on the core entry.

  The `server-functions` subpath resolves per environment like the main entry: the browser condition gets the fetch transport (`createServerReference(id)` producing the client callable with the `url`/`GET`/`withOptions` surface, `configureServerFunctionsClient` for the endpoint and codec), while node/worker/deno get registration (`registerServerReference`, `registerServerFunction`, `getServerFunction`), the SSR in-process callable (`createServerReference(reference)`), and the web-standard `handleServerFunctionRequest(request, options) => Response` handler with `createEvent`/`provideEvent`/`transformResult`/`handleNoJS` hooks for integrations. Compiled `"use server"` output (vite-plugin-solid) targets this module as its runtime. Event scoping defaults to the AsyncLocalStorage that `@solidjs/web/storage`'s `provideRequestEvent` parks on `globalThis[RequestContext]` — now a registered symbol so the separately bundled entries agree.

  The response helpers (`redirect`, `reload`, `respond`, plus `ResponseEnvelope`/`isResponseEnvelope`) export from the core `@solidjs/web` entry — both client and server builds, one import site regardless of usage. They construct plain `Response` objects carrying the protocol signals (`Location`, `X-Revalidate`, statuses); client-only actions return them and the integration interprets the Response in memory, while server functions return (or throw) the same objects and the HTTP handler forwards their metadata. `respond(value, init)` — `json()` from SolidStart/Solid Router, renamed for what it actually does: pair a value with the response metadata a naked return can't express. Progressive enhancement stays invisible: the carried response holds a plain JSON body so consumers without the client runtime (no-JS form posts, direct HTTP) get real JSON, while integrations read `value` with no reparse. Envelope detection uses a registered-symbol brand so identity survives the separately bundled entries.

- cded919: Bump dom-expressions to next.22. Beyond the server-functions runtime, the bundles pick up a deduplicated `DOMElements` set (~1 KB minified for consumers that retain it) and hydration-time insert/event behaviors moved behind a runtime slot installed by `hydrate()`, so client-only bundles tree-shake them.
- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
  - solid-js@2.0.0-beta.19

## 2.0.0-beta.18

### Minor Changes

- 9b4dd76: Add the `@solidjs/web/serialization` subpath exposing the runtime's Seroval serialization primitives: `createSerializer`, `DEFAULT_WEB_PLUGINS`, and `resolveSerializerPlugins` for the shared web plugin configuration, plus the isomorphic JSON codec (`serializeJSON` / `createJSONDeserializer`) for RPC-style transports such as server functions. The entry is opt-in — browser bundles only include it when imported, like `@solidjs/web/storage`. The seroval dependency floor moves to `~1.5.4` (1.5.3 and earlier carry a security issue; the codec also relies on `depthLimit` support).

### Patch Changes

- 9b4dd76: Bump dom-expressions to next.21 with the streamed fragment comment-scan fix and the reusable serializer/JSON-codec module backing the new `serialization` entry
- 43c537a: Emit `@solidjs/web/storage` types at the advertised path (#2873)

  The storage tsbuild used `rootDir: ".."`, so declarations landed at
  `storage/types/storage/src/index.d.ts` while package.json advertised
  `storage/types/index.d.ts`, breaking consumers of `@solidjs/web/storage`
  (e.g. solid-start). The build now resolves `@solidjs/web` against the built
  declarations and emits directly to `storage/types/index.d.ts`.

- 4a1d997: Portal no longer crashes SSR — portals are client-only islands (#2876)

  The server renders nothing for a `<Portal>`: children are never evaluated, no
  async starts, and nothing is serialized. Throwing (as earlier betas did) was
  caught by ancestor `Errored` boundaries and baked the error fallback into the
  streamed HTML for trees that render fine client-side.

  Both sides advance the parent's child-id counter by exactly one slot — the
  client scopes the portal's internals under a dedicated owner and the server
  consumes the matching id — so hydration ids for siblings after a portal stay
  aligned.

  On the client, the portal's content memo and effects are gated with
  `ssrSource: "client"`, so under hydration the children render fresh in the
  settle flush — no evaluation during the hydration walk, no effect-type
  switching (the 1.x timing hack). Async discovered inside a portal after
  settle forwards through already-initialized ancestor boundaries as ordinary
  pending status, so nothing regresses to a fallback; the portal simply attaches
  when its content is ready.

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
- be9a07a: Server `dynamic()` now supports Promise sources (#2779). A Promise component/tag source previously fell through the sync function/string checks and rendered nothing. It now follows `lazy()`'s SSR contract: block async renderers and throw `NotReadyError` from a sync memo until the promise lands, so the streaming engine captures the position as a retry hole. Requires `@dom-expressions/runtime` 0.50.0-next.15, where awaited `renderToStream` waits out blocked root holes.
- 06e45e8: Fix `Portal` stranding one empty text node in its mount target per unmount: the cleanup removed the nodes in `[startMarker, endMarker)` but never `endMarker` itself, which the same effect run had appended. Toggling a Portal (the modal open/close pattern) accumulated one node per cycle, unbounded — invisible to `innerHTML` checks but breaking `:empty` selectors and `childNodes` counts on the mount target. The removal range is now inclusive of `endMarker`.
- 098876d: Fix hydration key mismatches when async holes defer past eager siblings
  (#2801 bug 2). New `ssrScope` (server): reserves one hydration id slot at
  registration and evaluates the hole — including async retries — under the
  reserved id with a zeroed child counter (a virtual scope in the style of
  mapArray's row-owner elision, so no owner allocation on the hot path). On
  the client, `@solidjs/web`'s `effect` wrapper now honors a `scope: true`
  option (set by the dom-expressions `insert` for compiler-tagged hole
  accessors) that makes the outer insert render effect non-transparent, giving
  the same hole its own id scope. Hole content ids gain one nesting level
  identically on both sides, so deferral timing can no longer shift sibling
  hydration keys.
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

- a5d15f6: Fix Portal mount timing so earlier sibling refs can be used as Portal targets.
- 2c0a336: Rewrite `Portal` mounting: pass the real mount element to `insert` with the new `host` option instead of a `Proxy` wrapper, and run the insert in an owner-parented root that is disposed on mount change or Portal disposal. Fixes portal content accumulating on keyed swaps (#2757), `NO_OWNER_EFFECT` leaks from scheduled portal effects (#2758), and event retargeting for nodes inserted through replace paths.
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

- adbdab3: Portal now participates in root-owned delegated events by registering outside-root mount points as listener containers for the owning render root.
- Updated dependencies
  - solid-js@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.
- 6fec663: Remove `on:` namespace event typings and document ref callbacks for native listener options.
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

- e16371f: Performance: add `CONFIG_SYNC` opt-in for sync-only computeds/effects. New `sync?: boolean` option on `MemoOptions`/`EffectOptions` skips the async-shape probe in `recompute` for nodes that provably never return Promise/AsyncIterable. Compiler-emitted `_$effect` and `_$memo` (via `@solidjs/web`'s `effect`/`memo` wrappers) opt in by default — `01_run1k` mean −0.62 ms and `08_create1k-after1k_x2` mean −0.80 ms in `js-framework-benchmark`. User-authored `createMemo`/`createEffect`/`createRenderEffect` keep full async-aware behavior unless they explicitly pass `sync: true`. Returning a Promise from a `sync: true` node throws `SYNC_NODE_RECEIVED_ASYNC` in dev (production silently stores the unawaited value, by contract).

  Correctness: `flush(fn)` now drains at every nesting level instead of only the outermost. Nested `flush(fn)` calls each honor their own contract — writes inside an inner `flush(fn)` propagate before it returns, rather than being held until the outer `flush(fn)` exits. Microtask scheduling and arg-less `flush()` are unchanged. Code that depended on the old hold-until-outermost behavior should switch to a harness-layer depth counter (see `js-reactivity-benchmark`'s `r3` / `r3-solid-target` adapters for the pattern).

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

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.
- Updated dependencies [59dd11f]
- Updated dependencies [e841f8c]
- Updated dependencies [a93a216]
- Updated dependencies [cf92b55]
- Updated dependencies [2a7c6a5]
  - solid-js@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- d8d8c95: Reshape `createDynamic` into a `dynamic` factory.

  `createDynamic(source, props): JSX.Element` is replaced by `dynamic(source): Component<P>` — a `lazy`-style factory returning a stable component whose identity is driven by a reactive (and optionally async) source. `source` may return `null | undefined | false` to render nothing, so `() => cond() && Comp` works directly.

  ```tsx
  const Active = dynamic(() => (isEditing() ? Editor : Viewer));
  return <Active value={value()} />;
  ```

  The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; it now delegates to `dynamic` internally. Direct callers of `createDynamic(source, props)` should use `<Dynamic>` or `createComponent(dynamic(source), props)`.

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

- 34c65b8: CSR: async reads without a `Loading` ancestor no longer throw. The root mount now participates in transitions — when uncaught async surfaces during initial render, the root DOM attach is withheld until all pending settles and then attaches atomically. On the no-async happy path, `render()` still attaches synchronously before returning (via an internal tail `flush()`).

  **New `schedule` option on effects**

  `@solidjs/signals` exposes a new `schedule?: boolean` option on `EffectOptions`. When `true`, the initial effect callback is enqueued through the effect queue (the same path user effects already take) instead of running synchronously at creation. This lets the initial run participate in transitions — if any source bails during the compute phase, the callback is held until the transition settles.

  ```ts
  createRenderEffect(
    () => source(),
    v => {
      /* runs after flush, deferred by any pending transition */
    },
    { schedule: true }
  );
  ```

  `@solidjs/web`'s `render()` uses this option internally for its top-level insert, which is what enables permissive top-level async in CSR.

  **Dev diagnostic**

  `ASYNC_OUTSIDE_LOADING_BOUNDARY` is now a non-halting `console.warn` (severity downgraded from `error` to `warn`). With deferred-mount the runtime is correct; the diagnostic is an informative FYI rather than a correctness failure. The warning only fires during the synchronous body of `render()` / `hydrate()` — post-mount transitions (including lazy route changes) run under their own transitions with the guard off and do not emit this warning.

  Placing a `Loading` boundary remains the right tool when you want explicit fallback UI or partial progressive mount.

  **Known limitation: multi-phase async**

  Multi-phase async flows — for example, a `lazy()` component whose resolved body reads a second pending async memo — may still reveal partial DOM between waves. This is because the scheduler currently nulls `activeTransition` before running the completing flush's restored queues; a new transition started by recomputes during that phase does not re-stash already-restored callbacks. Single-wave nested async (including static siblings alongside a pending descendant) commits atomically. The multi-phase case is tracked as a follow-up; the recommended workaround today is to place a `Loading` boundary around multi-phase async subtrees.

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
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [76b11b2]
- Updated dependencies [5869c94]
- Updated dependencies [3242e50]
- Updated dependencies [f18780e]
- Updated dependencies [ea7f892]
- Updated dependencies [5acf0ee]
- Updated dependencies [beb419e]
- Updated dependencies [bd563d0]
- Updated dependencies [e855fcb]
- Updated dependencies [5086c21]
- Updated dependencies [8511fc1]
  - solid-js@2.0.0-beta.7
  - @solidjs/signals@2.0.0-beta.7

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

- 2922dbb: Add regression coverage for SSR Show hydration placement so Show content hydrates before its following sibling once the dom-expressions runtime fix is published.
- 8d3e093: Update the bundled `dom-expressions`, `hyper-dom-expressions`, and `lit-dom-expressions` baseline to pick up the spread children caching fix, and add regression coverage for intrinsic spread children and `Dynamic component="div"` granularity.
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

- 8187065: Fix unnecessary sibling re-rendering when Show/conditional children update by wrapping insert accessor in a transparent memo, with reactive accessor detection to skip redundant memoization
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
  - solid-js@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

- Updated dependencies [dadeeeb]
  - solid-js@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- b1646a5: update signals
- c74106f: fix multi insert/removal, ssr wip, async signal render
- 433eae5: Add `runWithOwner` to rxcore shim to support callback refs from updated dom-expressions runtime
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
