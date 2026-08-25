# babel-plugin-jsx-dom-expressions

## 0.50.0-next.44

### Patch Changes

- b9670bd: Patch-mode list admission is now compile-time only: the plugin proves row purity per row function (single-param, one compiled template, no reactive or owned emissions, all dynamics in one patchDriver body registered on the row param itself) and wraps qualifying functions with the new `rowProof` runtime marker at program exit. The runtime purity probe is deleted — no speculative execution of user row code, no first-row sampling, no tentative empty-list engagement — and unstamped rows decline to the classic mapArray path before any DOM work. Extracted row functions now qualify at their definition site, which the runtime probe could never see.
- bba3db6: Treat a native `children` attribute as child content — template-inlined when static, inserted when dynamic — instead of writing the read-only DOM `children` property. Explicit JSX children still win; named `children` versus a spread keeps source order.
- e9ac254: The Oxc compiler ports patch-mode compilation and compile-time row proofs (DESIGN-PATCH-CHANNEL PR-C/§3c), closing the one-sided feature gap: eligible template scopes compile to `patchDriver` bodies and proven-pure row functions are wrapped with `rowProof`, byte-identical to the Babel plugin's emission (the parity harness no longer pins `patchDriver: false`). The subject guard resolves through the binding table (function params now declared; program-wide reassignment scan approximates Babel's `binding.constant`). The Babel plugin aligns its patch-body locals to the fixed `_n$`/`_p$`/`_f$`/`_v$` convention for cross-compiler parity.
- 7414c1d: Stage 6 (behavior across the border), server half: behind the new `serverComponents` compiler option, ref/on\* positions on server-rendered intrinsic elements compile to one guarded whole-attribute claim hole per element — `sharedConfig.context.claims ? ssrClaim({ click: expr, ref: expr2 }) : ""` — emitting a `_bnd="pos=prop"` marker naming the slot-props stub's prop. Apps not enabling the option compile byte-for-byte as before; plain SSR in an enabled app pays property reads and never evaluates the expressions. The claims gate is on for the whole render on the stream face, scope-gated to server-component interiors on the document face, and off inside client-owned fill windows (a new `clientOwned` counter, distinct from mint suppression so hole re-emissions keep their markers).
- 95bd823: Gate SSR select-value resolution behind a compiler-armed flag and region-jump the resolver. Compiled output containing a select value binding (or a spread on a select) emits one ssrSelectValues() marker per module; apps that never bind a select value skip the resolution pass entirely — it was costing over half of select-free render time (the first full-output scan pays the rope flatten), worth 2.2x on news-page SSR throughput and it ran per streamed fragment. Armed pages walk only select regions (2.15x on a large page with one bound select) instead of every tag in the document; to make region jumps sound, attribute values now escape `<` alongside `&` and `"` in both compilers (matching React/Octane norms). Raw HTML injected around the compiler gets browser semantics for select values — the forms contract is a JSX-level promise.

## 0.50.0-next.43

### Patch Changes

- d1a392c: Keyed element matching in the frame morph: `$key` on an intrinsic element in server JSX compiles to a `_key` attribute (SSR-only — DOM compiles strip it, components pass it through as slot identity), and the morph matches keyed elements by key instead of by position. Live element state the morph deliberately preserves — `value`/`checked` properties, `open` on `<details>`, focus — now follows the entity across reordering morphs instead of latching to its old position (previously, a keyed list reorder silently reattributed user state to whatever entity landed at that position). Sibling-scoped, matching client `For` semantics; unkeyed elements keep positional matching unchanged.
- 435e45f: SSR now HTML-escapes the static parts of template literals used as
  attribute and style values, so quotes in expressions like
  `url("${src}")` stay inside the attribute.

## 0.50.0-next.42

## 0.50.0-next.41

## 0.50.0-next.40

## 0.50.0-next.39

## 0.50.0-next.38

## 0.50.0-next.37

## 0.50.0-next.36

## 0.50.0-next.35

### Patch Changes

- 851ef22: Fix hydration id drift from asymmetric condition memos (#2959)

  Two positions emitted a condition memo on one generate but not the other,
  so the client consumed hydration ids the server never allocated and every
  id after the conditional drifted (unclaimed `<For>` rows, mismatched
  serialized async lookups):
  - Element spread conditional attributes: the dom generate memo-wrapped
    `{...spread} attr={cond ? a : b}` getters while ssr emitted the bare
    expression. The memo is now dropped on the dom side — attribute values
    are primitives and the spread assign pass already dedupes writes against
    previous values, so the memo only added per-read churn. The universal
    generate keeps its memo: no hydration ids exist there and
    custom-renderer prop values can be arbitrarily expensive.
  - Component conditional props: the dom generate memo-wrapped
    `<Comp prop={cond ? a : b} />` getters while ssr emitted the bare
    expression. The memo is now emitted on the ssr side too — the server
    sync memo allocates an owner id exactly like the client's, and the wrap
    keeps its truthiness insulation (prop values can be expensive). Matches
    the children-conditional wrap, which was already symmetric.

  Both fixes land identically in the Babel plugin and the Rust compiler.

## 0.50.0-next.34

## 0.50.0-next.33

## 0.50.0-next.32

## 0.50.0-next.31

## 0.50.0-next.30

## 0.50.0-next.29

## 0.50.0-next.28

## 0.50.0-next.27

## 0.50.0-next.26

## 0.50.0-next.25

### Patch Changes

- 6da0028: Element-claim contract for navigation-relevant elements (Wave B, dormant):
  - New runtime hooks in the client module: `registerElementClaim(handler)`
    subscribes a consumer (returns an unregister function) and
    `claimElement(node)` invokes registered handlers. With no consumer
    registered every emitted claim is a null check — apps without a routing
    integration pay effectively nothing. The server module exports silent
    no-ops so consumers can register isomorphically.
  - Compiled DOM output (both the Rust compiler and the Babel plugin) now
    claims `a[href]` and `form[action]` elements at creation — including under
    spreads, where the tag is still statically known. Previously reference-free
    static anchors gain a positional walk so the claim call has a target.
  - Compiler-owned writes to `href`/`action` (binding effects and spread
    assigns, which both land in the runtime's `setAttribute`) re-invoke the
    registered handlers, so a consumer's per-element state stays fresh with no
    observers; handlers must be idempotent.

  This is groundwork for router integrations (e.g. link active/pending state
  on plain `<a>` elements without a wrapper component); behavior is inert
  until a consumer registers.

## 0.50.0-next.24

## 0.50.0-next.23

## 0.50.0-next.22

## 0.50.0-next.21

## 0.50.0-next.20

## 0.50.0-next.19

## 0.50.0-next.18

## 0.50.0-next.17

### Patch Changes

- 203c9d5: Fix two option-handling bugs surfaced by the compiler parity sweep:
  - `memoWrapper: false` no longer crashes when a conditional or logical expression is transformed (`transformCondition` registered an import under the falsy wrapper name). Conditions now compile memo-less: hoisted conditions keep a plain `var _c$ = () => !!cond` thunk and inline conditions collapse to an immediately-invoked thunk.
  - `inlineStyles: false` no longer silently drops a literal `style` on a child element whose position otherwise allocates no element reference (e.g. `<svg><rect style="fill:red"/><g/></svg>` lost the style entirely). `detectExpressions` now accounts for the style-to-IIFE rewrite, so the element gets a reference and the style compiles to the expected effect.

  The `effectWrapper`/`memoWrapper` config types now admit `false` alongside the import-name string.

- bb7b2fd: Fix omitLastClosingTag corrupting templates when per-slot insertion markers follow the last static element. An element trailed by two or more dynamic slots now keeps its closing tag, so the trailing `<!>` placeholders parse as its siblings instead of being swallowed as children of the still-open element (which crashed the template walk with "Cannot read properties of null (reading 'nextSibling')").
- 4686501: Fix hydration id drift for spread elements with dynamic children. The ssr generate's spread-element path (`ssrElement`) never applied the hole id `scope()` wrap that `transformChildren` applies on the template path — while the dom generate scope-wraps the matching insert accessor regardless of spread. For a shape like `<a {...props}>{children()}</a>`, the client reserved one hydration id for the hole and the server did not, so every hydration key allocated after the hole drifted and the following siblings were left unclaimed (duplicated DOM, "unclaimed server-rendered node" warnings). `createElement` now wraps dynamic, id-allocating children holes in `scope()` exactly like the template path.
- 241ff76: Fix a spread element with dynamic props being left unclaimed on hydration. `mergeProps` with a function source creates a memo, which consumes a hydration child id. The ssr generate evaluated `mergeProps(...)` in `ssrElement`'s argument position — before the element's own hydration key was allocated — while the client claims the element (`getNextElement`) before applying the spread. The element's id shifted by one on the server and the client re-created it instead of claiming (later siblings re-synced, hiding the drift; a `<title>` rendered this way duplicated on every hydration). The ssr generate now defers the merge behind a thunk when hydratable and `ssrElement` allocates the hydration key before resolving function props, matching the client's allocation order.

## 0.50.0-next.16

### Patch Changes

- 04849df: Preserve JS value semantics for wrapped `&&` conditions (#532). The dom generate's condition wrap used to emit `memo(() => !!left)() && right`, collapsing every falsy left value to `false` — visibly wrong for component props (`undefined` became `false`, breaking `== null` checks) and a hydration mismatch against the untransformed server output (`{0 && <div/>}` rendered "0" on the server, nothing on the client). `left && right` is exactly `left ? right : left`, so the wrap now emits `memo(() => !!left)() ? right : left`: branching still keys off the memoized truthiness (truthy-value churn never re-creates the right side) while the alternate returns the raw left, matching the server for free. Statically boolean lefts (comparisons, `!x`) keep the plain `memo(() => left)() && right` form — the memo's value is the expression's value, so it's already exact with no second evaluation. Ported identically to the Rust jsx-compiler.
- 248f784: fix(compiler): key the hole `scope()` wrap off the transform's `dynamic` flag instead of the transformed expression shape. The dom generate simplifies `{sig()}` to the bare getter `sig`, which the old `isDeferredChildSlotExpression` predicate didn't count as deferred while the matching ssr arrow was — so the server scope-wrapped the hole and the client didn't, shifting every sibling hydration id after it. Bare getters are re-wrapped as `() => sig()` on the dom side so `scope()` doesn't tag the user's function.
- c2a542b: Fix hydration key mismatches when async holes defer past eager siblings
  (solidjs/solid#2801 bug 2). Dynamic element children that can allocate
  hydration ids (conditionals, component-children access, call expressions)
  are now compiled with their own id scope on both generates: the dom and ssr
  generates wrap the hole expression in a new `scope()` runtime helper using a
  shared predicate, so marking cannot desync.

  On the client, `scope(fn)` tags the accessor and `insert()` makes the outer
  render effect non-transparent (its own id scope) for tagged accessors; the
  inner unwrapping effect stays transparent so content ids keep a fixed depth.
  On the server, `scope` (framework-provided via rxcore as `ssrScope`) reserves
  one id slot at registration and evaluates the hole — including async retries
  — under that reserved id with a zeroed child counter, so retry timing can no
  longer shift sibling ids. The ssr generate's `orderedInsert` sibling
  thunk-wrapping is removed; it is superseded by hole scopes.

  Hole content ids gain one nesting level (e.g. `_hk=10` instead of `_hk=1`)
  identically on both sides. rxcore implementations must provide an `ssrScope`
  export and honor a `scope: true` effect option (mapped to a non-transparent
  render effect).

- bb7470e: Give every dynamic child slot its own insertion marker when a parent hosts more than one (solidjs/solid#2830). Adjacent expression slots used to share a marker (`null` at the tail, a shared following sibling, or one reused `<!>` between text), which collapsed them into a single `$$SLOT` ownership region: a node migrating between adjacent slots was destroyed by the slot it left, arrays exchanging members could throw `NotFoundError`, and a slot emptied via `[]` refilled at the wrong position. Slots in multi-slot parents now ride the immediately following static sibling or get a dedicated `<!>` placeholder — the same per-slot geometry hydratable output has always produced, which is why these shapes already worked after hydration. Zero runtime changes; single-slot parents compile byte-identically to before.
- 668264f: Universal JSX now passes compile-time static host props to `createElement(tag, staticProps)` so custom renderers can configure nodes before children are inserted. Dynamic props and elements with spreads continue to use the existing `setProp` / `spread` paths.

## 0.50.0-next.15

### Patch Changes

- df03fb8: Move all packages under the `@dom-expressions` npm scope with new names:
  - `dom-expressions` → `@dom-expressions/runtime`
  - `babel-plugin-jsx-dom-expressions` → `@dom-expressions/babel-plugin-jsx`
  - `jsx-dom-expressions-compiler` → `@dom-expressions/jsx-compiler`
  - `hyper-dom-expressions` → `@dom-expressions/hyperscript`
  - `tagged-jsx-dom-expressions` → `@dom-expressions/tagged-jsx`

  The old unscoped names stop receiving `next` prereleases and remain in use
  only by the Solid 1.x maintenance line published from `main`.

  `lit-dom-expressions` is dropped from the prerelease line; it has been
  superseded by `@dom-expressions/tagged-jsx`.

  `@dom-expressions/jsx-compiler` now distributes prebuilt native binaries
  through per-platform packages (`@dom-expressions/jsx-compiler-darwin-x64`,
  `-darwin-arm64`, `-linux-x64-gnu`, `-linux-arm64-gnu`, `-win32-x64-msvc`)
  resolved automatically via `optionalDependencies`, instead of shipping a
  binary inside the main package.

## 0.50.0-next.14

### Patch Changes

- 9a64f1f: Preserve SSR child evaluation order for deferred hydratable insert slots.

## 0.50.0-next.13

### Patch Changes

- f1bcd5f: Stop giving special compiler handling to `style:foo` and `class:foo` JSX namespace syntax, and rename the static compiler marker from `@once` to `@static`. `style:foo` and `class:foo` now fall through to literal HTML attributes (e.g. `<div style:border="1px solid black">` emits `style:border` verbatim).

  Internal optimizations still split `style={{...}}` into `setStyleProperty` calls and `class={{...}}` into `classList.toggle` calls.

- f17f7a1: Rename the generated event listener helper from `addEventListener` to `addEvent` so compiled browser bundles no longer introduce a binding that can shadow the native `window.addEventListener` method.

## 0.50.0-next.12

### Patch Changes

- Port relevant maintenance fixes from the stable branch. Add `omitAttributeSpacing` for strict template attribute spacing, and align `server.js`/`server.d.ts` with the current `client.d.ts` export surface so isomorphic imports continue to resolve on the server.

## 0.50.0-next.11

### Patch Changes

- d5cd499: Remove `on:` namespace event support from compiler, runtime, JSX types, and renderer packages.

## 0.50.0-next.10

### Patch Changes

- ba2c493: Update the JSX compiler source to TypeScript and refresh its generated output expectations for the current Babel and Rollup toolchain.

## 0.50.0-next.9

## 0.50.0-next.8

## 0.50.0-next.7

### Patch Changes

- 0bd165e: Preserve shared class tokens when diffing object keys that contain multiple class names.
  Ensure class-method JSX captures `this` before lifted DOM setup statements run.
- e7831bd: Optimize class arrays with leading static class strings and a fixed-shape class object so the static classes are emitted in the template and dynamic object entries compile to class toggles.
- 10f3250: SSR: group contiguous attribute and `textContent` closures into a single
  `_$ssrGroup(() => […], N)` call per element so the runtime can resolve
  all `N` hole positions with one closure invocation instead of `N`. The
  compiler walks each top-level element's `templateValues`, identifies
  runs of `≥2` groupable entries (inserts/children break a run, preserving
  child isolation), and replaces them with one grouped declarator repeated
  `N` times in the `ssr(...)` argument list. `_$ssrGroup` tags the
  function with `fn.$g = N` so `ssr()` can dispatch through a fast path
  that's gated at the end of the typeof chain — non-function holes pay
  nothing for the new branch.

  For the async escalation path (group fn throws `NotReadyError`), every
  retry slot for the group shares a module-scoped cache keyed on `fn`:
  slot 0 evaluates and caches `arr` (success) or `err` (still-pending),
  slots `1..N-1` short-circuit on the cached outcome, and the cache
  invalidates when slot 0 re-fires next pass. Net retry cost: 1 evaluation
  per group per pass on either outcome — `N²` → `N` on success, `N²` → `1`
  on failure — with no per-state bookkeeping.

  Bench: `+15%` on `search-results` (heavy attribute usage), neutral on
  `color-picker` (no qualifying groups). Hydration ids are unaffected:
  attribute/textContent expressions never allocate ids, and inserts (which
  do) stay outside groups by construction.

- 3574228: SSR rendering performance pass.

  **Runtime (`dom-expressions`):**
  - Inline hole resolution in `ssr()`. Switch from a `(t, ...nodes)` rest
    parameter to an `arguments` walk, eliminating the per-call holes-array
    allocation. Inline `string`/`number`/`null`/`boolean` fast paths skip
    `tryResolveString` for the typical "all-static-after-eval" hole shape; only
    the heavy path (async escalation) materializes the `{ t, h, p }` result.
  - Single forward-pass `escape()`. The previous implementation walked the
    string twice in the hot path (`indexOf(delim)` + `indexOf("&")` upfront
    then early-exit on the no-hit case). Replaced with a `charCodeAt` loop
    that bails after one pass for clean strings (the common case), and
    resumes the slow path from the first hit so the clean prefix isn't
    re-scanned.
  - Remove the `ssrRunInScope` public export. The function had been a true
    pass-through identity (`fn => fn`) since owner-capture moved into
    `tryResolveString`'s `NotReadyError` handler, and the compiler stopped
    emitting it. With no internal callers and no behavior, the export was
    dead surface area. User code that called it can drop the wrap (it was a
    no-op) or replicate the original deferred-callback owner-capture intent
    in two lines with `getOwner()` + `runWithOwner()`.

  **Compiler (`babel-plugin-jsx-dom-expressions`):**
  - IIFE elision in statement-position JSX. When `<jsx/>` is the argument of
    a `return` or the initializer of a `const` (the overwhelmingly common
    shapes), the surrounding IIFE is removed and the body lifts to flat
    statements before the parent. Saves one closure allocation + one
    function-call frame per render. Applies to `dom`, `ssr`, and `universal`
    emissions; expression-position JSX (ternary branches, array elements,
    function args) keeps the IIFE since lifting would change observable
    evaluation semantics.
  - SSR templates emit hoisted `var` declarations for dynamic-expression temp
    vars instead of wrapping the whole thing in an IIFE. In statement
    position the declarations precede the `ssr(...)` call; in expression
    position they hoist to the enclosing function scope and the
    assignment + call become a comma sequence expression.
  - Drop `ssrRunInScope` emission around dynamic SSR expressions. The
    temp-var hoist stays — it's a V8 IC-stability tactic (keeps the `ssr()`
    call site specialized on `Identifier` argument shapes), not an
    evaluation-order requirement. Ordering is preserved by JS left-to-right
    semantics.
  - Drop `createComponent` wrap on SSR component invocations. The SSR
    runtime's `createComponent` is `Comp(props || {})`; the compiler always
    emits a real `props` object, so the `|| {}` fallback never fires. Inline
    to a direct `Comp(props)` call. DOM / dev modes keep the wrapper since
    it does real work (`untrack`, dev metadata).

  Net effect on representative SSR shapes (color-picker, search-results) is
  fewer allocations per render and a flatter call graph through the hot path.

- 6ae1a40: Replace the `wrapDynamics` previous-value default-object initializer with optional chaining for both DOM and universal generators. The combined-effect arrow now takes `(_v$, _p$) => …` and reads `_p$?.<n>` instead of receiving an `_p$ = { 0: undefined, 1: undefined, … }` defaulted object literal. Removes a per-render-effect setup allocation, shrinks compiled output, and matches the shape used elsewhere in the runtime. The DOM generator special-cases `textContent` (`!_p$ || a !== _p$.a`) to keep the first-run write semantics.

## 0.50.0-next.6

## 0.50.0-next.5

## 0.50.0-next.4

## 0.50.0-next.3

### Patch Changes

- 4dae801: Normalize the `repository` field in every package to the standard npm
  convention: a `git+https://github.com/ryansolid/dom-expressions.git` URL
  with a `directory` pointing at the package within the monorepo. Restores
  "View source" / "Open in repo" links on the npm registry and unblocks
  tooling that resolves source from package metadata.
- 1cc342c: Unify the compiler's void-element list with the runtime's `VoidElements` set in `dom-expressions/src/constants`. The compiler previously kept its own array (`src/VoidElements.ts`) that still contained the long-deprecated `keygen` and `menuitem` tags. Both have been removed from the HTML standard and are no longer parsed as void by modern browsers, so the compiler now emits closing tags for them — which is the correct behaviour in current browsers and was a latent bug otherwise. All other void elements are unaffected.

## 0.50.0-next.2

### Patch Changes

- 4d14c82: Fix single-dynamic attribute accessors being silently invoked with the
  previous value. Given `<div style={source()} />`, the compiler previously
  emitted `effect(source, (v, p) => style(el, v, p))`, which causes the
  reactive core to call `source(p)` — leaking `prev` into a user-authored
  accessor that the source expression wrote as a zero-arg call. Polymorphic
  accessors (e.g. atom-style signals) would observe an unexpected argument
  and misbehave.

  The compute position now emits `() => source()` so the user's call shape
  is preserved. The prior optimization of unwrapping an IIFE
  (`(() => x)()` → `() => x`) is retained since IIFEs are zero-arg and
  cannot leak `prev`.

  Fixes #510.

- 39c207c: Fix a SyntaxError when an element has 222+ merged dynamic attributes
  (solidjs/solid#2682). The internal identifier generator produced `in` at
  index 221, and since these identifiers are emitted as object shorthand
  destructuring bindings, the resulting `({ …, in }) => …` could not be parsed.
  `getNumberedId` now shifts past any natural index that would encode to a JS
  reserved word, keeping the mapping injective and the output at 2 characters
  for all practical dynamic counts.
- 03da8a5: Fix SSR escaping gaps reachable from JSX, and tighten the compiler so
  redundant runtime `escape` calls drop out of the output.

  Security fixes:
  - `ssrStyle` and `ssrClassName` now attribute-escape object keys, not
    just values. Previously a user-controlled key in `<div style={{…}} />`
    or `<div class={{…}} />` could break out of the surrounding attribute.
  - Dynamic fragment-child expressions (`<>{state.text}</>`) now compile
    to `_$memo(() => _$escape(expr))`. Element-child expressions already
    escaped via `escapeExpression`; fragment children reached SSR through
    a separate path and were concatenated raw.
  - Computed-key object styles (`style={{ [k]: v }}`) escape the key at
    compile time.

  Compiler alignment:
  - SSR now matches DOM in rejecting fragments placed directly inside an
    element: `<div><>…</></div>` is a compile error in both renderers.
    Fragments reached via conditionals (`<div>{cond && <>…</>}</div>`)
    remain legal.

  Compiler optimizations:
  - `escapeExpression` drops the outer `_$escape` wrap on a `JSXFragment`
    when its single significant child is either a dynamic expression
    (compiles to a memoized accessor function, `escape(fn)` is a no-op)
    or a native element (compiles to an `_$ssr(…)` SSR node object,
    `escape(object)` is a no-op). This turns
    `cond && _$escape(_$memo(() => _$escape(state.text)))` into
    `cond && _$memo(() => _$escape(state.text))`, and
    `cond && _$escape(_$ssr(_tmpl$N))` into `cond && _$ssr(_tmpl$N)`.

  SSR fixtures for `components`, `conditionalExpressions`, `fragments`,
  and `attributeExpressions` regenerate. Each security fix has a JSX
  round-trip test in `packages/dom-expressions/test/ssr/jsx.spec.jsx`
  that feeds hostile input through `renderToString`.

- 305d9ce: - SSR: Duplicate attributes in JSX without spreads are now deduplicated —
  `<div class="a" class="b" />` correctly renders as `<div class="b" />`
  (last-wins), matching client behavior. Previously the compiler kept both
  attributes in the output.
  - Client: `setAttributeNS` / `removeAttributeNS` now use matching names when
    clearing namespaced attributes (e.g. `xlink:href`). Previously removal could
    leave the attribute in place because it used the local name while the set
    used the qualified name.
  - Expanded test coverage across all four packages; no other behavior changes.

## 0.50.0-next.1

### Patch Changes

- ee365e0: - `insert()` accepts an optional 5th `options` argument that is forwarded to the
  internal `effect()` call, letting callers (e.g. Solid's `render()`) opt into
  transition-aware initial mounts without otherwise changing `insert`'s
  behavior.
  - SSR: `$dflj(ids)` now materializes every id in the list in a single call
    instead of stopping after the first successful `$dfl`. Callers pass only the
    keys they intend to materialize, which simplifies the primitive and composes
    cleanly for bulk-uncollapse cases (e.g. a group activation revealing several
    held fallbacks at once).
  - SSR: Fix cascading async root holes in the streaming shell. When an inner
    Loading boundary resolved its first chunk while the outer shell was still
    pending, `flushEnd` could call `serializer.flush()` before `doShell()` had
    written the root `_assets` module map, causing seroval to silently drop the
    writes and client hydration to fail with "module was not preloaded". Root
    asset serialization is now memoized and gated on both paths.
  - Type formatting cleanup in `jsx-properties.d.ts`.
