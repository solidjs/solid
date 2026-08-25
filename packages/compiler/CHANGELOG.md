# @dom-expressions/compiler

## 0.50.0-next.44

### Minor Changes

- e9ac254: The Oxc compiler ports patch-mode compilation and compile-time row proofs (DESIGN-PATCH-CHANNEL PR-C/§3c), closing the one-sided feature gap: eligible template scopes compile to `patchDriver` bodies and proven-pure row functions are wrapped with `rowProof`, byte-identical to the Babel plugin's emission (the parity harness no longer pins `patchDriver: false`). The subject guard resolves through the binding table (function params now declared; program-wide reassignment scan approximates Babel's `binding.constant`). The Babel plugin aligns its patch-body locals to the fixed `_n$`/`_p$`/`_f$`/`_v$` convention for cross-compiler parity.

### Patch Changes

- 152cb59: The WASI compiler binary links on rust-lld 1.95 again. `napi-build` 2.4.1 hard-exported `emnapi_create_env` / `emnapi_delete_env` for emnapi v2 archives; we still ship emnapi 1.x, so those `--export`s now use `--export-if-defined`.
- b277167: Expose a host-independent Rust compile API while keeping the existing Node
  adapter and its interface enabled by default. The Rust API surface is
  unstable pre-1.0 and carries no semver commitment; the Node `transform()`
  interface remains the supported public contract.
- bba3db6: Treat a native `children` attribute as child content — template-inlined when static, inserted when dynamic — instead of writing the read-only DOM `children` property. Explicit JSX children still win; named `children` versus a spread keeps source order.
- a2ec7bc: SSR `serverComponents` option parity with the Babel plugin: ref/on\* positions on intrinsic elements compile to one guarded `_$ssrClaim` hole per element (the `_bnd` behavior-claim marker) instead of dropping.
- 95bd823: Gate SSR select-value resolution behind a compiler-armed flag and region-jump the resolver. Compiled output containing a select value binding (or a spread on a select) emits one ssrSelectValues() marker per module; apps that never bind a select value skip the resolution pass entirely — it was costing over half of select-free render time (the first full-output scan pays the rope flatten), worth 2.2x on news-page SSR throughput and it ran per streamed fragment. Armed pages walk only select regions (2.15x on a large page with one bound select) instead of every tag in the document; to make region jumps sound, attribute values now escape `<` alongside `&` and `"` in both compilers (matching React/Octane norms). Raw HTML injected around the compiler gets browser semantics for select values — the forms contract is a JSX-level promise.

## 0.50.0-next.43

### Patch Changes

- 287875f: A component (or spread child) boxed by static text now gets a dedicated `<!>` insertion marker in the dom generate, matching Babel's `wrappedByText` behavior. Without it the surrounding template texts merged into a single node during HTML parsing, so the following-sibling walk resolved to null and the inserted content landed after the trailing text (solidjs/solid#3004: `<p>(<Comp />)</p>` rendered `()…` with the component appended at the end).
- d1a392c: Keyed element matching in the frame morph: `$key` on an intrinsic element in server JSX compiles to a `_key` attribute (SSR-only — DOM compiles strip it, components pass it through as slot identity), and the morph matches keyed elements by key instead of by position. Live element state the morph deliberately preserves — `value`/`checked` properties, `open` on `<details>`, focus — now follows the entity across reordering morphs instead of latching to its old position (previously, a keyed list reorder silently reattributed user state to whatever entity landed at that position). Sibling-scoped, matching client `For` semantics; unkeyed elements keep positional matching unchanged.
- 0856717: `transformLazy` now appends the module-URL placeholder as `lazy()`'s third argument (padding the options slot with `void 0` when omitted), matching `clientOnly`'s shape: `solid-js` 2.0's `lazy(fn, options?, moduleUrl?)` takes an `{ export }` options bag in second position. Call sites with an options bag (`lazy(fn, { export: "Name" })`) are now annotated too.
- 435e45f: SSR now HTML-escapes the static parts of template literals used as
  attribute and style values, so quotes in expressions like
  `url("${src}")` stay inside the attribute.
- 88703b6: Upgrade the native compiler to Rust 1.95, Oxc 0.144, and the latest compatible N-API and transitive dependencies while supporting Oxc's updated AST, parser diagnostics, and code generation behavior.
- WASI builds link again on rust-lld 1.95+: `napi-build` 2.4.1 hard-exports `emnapi_create_env` / `emnapi_delete_env` for emnapi v2 archives we do not ship, so the WASI `build.rs` path uses `--export-if-defined` for those symbols.

## 0.50.0-next.42

## 0.50.0-next.41

## 0.50.0-next.40

## 0.50.0-next.39

## 0.50.0-next.38

## 0.50.0-next.37

### Patch Changes

- 6c6e2c7: Directive DCE removes an import whose surviving specifiers are all type-only. Pruning the last value specifier out of a mixed import left `import { type Session } from "./server-module"` behind — no runtime binding, but still a module load of server code in the client bundle, exactly the leak the shake guards against. The whole-declaration decision now counts value specifiers (default and namespace specifiers count; declaration-level `import type` counts none), mirroring the Babel implementation's fix in solid-start #2273. Imports the shake never touched stay untouched, and a mixed import keeping a live value specifier survives with its type specifiers intact.

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

- 7b8b417: Extend the `lazy()` module-URL pass (`transformLazy`) to also recognize `clientOnly(() => import("specifier"))` calls where `clientOnly` is a named import from `@solidjs/web`, so the server half can emit early modulepreload hints for browser-only modules. Because `clientOnly` takes an options bag in second position, the placeholder is appended as a third argument, padding the options slot with `void 0` when the call site omits it. Same placeholder format and plugin resolution contract as `lazy()`; already-annotated calls and other import sources are left untouched.

## 0.50.0-next.34

## 0.50.0-next.33

## 0.50.0-next.32

### Patch Changes

- 7c7aa08: Fix exponential compile time in deeply nested component trees. A file whose JSX nested function scopes 14 levels deep took 3.6 seconds to compile, 16 levels took 32 seconds, and anything deeper effectively hung the build — the cost grew as 3^depth in nesting, so a single deep component tree could stall a whole project's build.

  The deferred JSX pass handed every nested function expression back to the transform's own traversal, which re-entered statement processing for that body. Because `process_statements` runs the deferred lowerer twice per statement, each level processed its children three times. Bodies are now marked as they finish and skipped when the deferred pass meets them again, which visits every body exactly once and makes the transform linear: depth 14 goes from 3.6s to 0.1ms, and depth 800 compiles in 2.4ms. Generated output is unchanged in all three modes (`dom`, `ssr`, `universal`).

## 0.50.0-next.31

### Patch Changes

- f19f6ee: Match Babel DOM output by preserving forced `prop:` writes through spreads, respecting spread precedence over earlier `children` attributes, discarding children of HTML void elements, and applying last-value-wins semantics after stateful DOM property aliases are normalized.

## 0.50.0-next.30

## 0.50.0-next.29

### Patch Changes

- 471d86f: Match Babel when native elements have duplicate dynamic `children` attributes by compiling the last value instead of the first.

## 0.50.0-next.28

## 0.50.0-next.27

## 0.50.0-next.26

## 0.50.0-next.25

### Patch Changes

- 0be1d19: Close two client-DCE parity gaps in the `"use server"` directive transform against the Babel reference (SolidStart's `remove-unused-variables` pass), and fix a hang the gaps were masking:
  - Declarations orphaned by the server-function rewrite are now pruned everywhere the reference pruned them, not just in statement lists: `for` initializers, `for-in`/`for-of` left-hand patterns, single-statement `if`/`while`/`do-while`/labeled bodies (emptied bodies become `{}`, matching Babel), and inside `try`/`catch` blocks — a module-level `try { var conn = connect(); } catch (e) { log(e); }` whose declarator's only reads lived in an extracted body now sheds the declarator (and the imports it stranded) while the try/catch shell and catch binding stay, per the reference semantics.
  - Individual rewrite-orphaned elements of destructuring patterns in loop heads are now pruned like their statement-position counterparts (`for (const { meta, name } of rows)` drops `meta` when only extracted code read it). When every element of a loop-left pattern is orphaned the pattern empties to `{}` and the loop keeps iterating — a deliberate improvement over the Babel reference, which crashes trying to remove the entire loop binding.
  - The removal fixpoint now tracks whether a pass actually mutated the tree and stops when none does, instead of looping forever when a requested removal wasn't structurally applicable (previously an infinite loop on orphan names colliding with loop-head bindings).

  The established invariants are unchanged: only rewrite-orphaned bindings are shaken, exported bindings never are, and direct `eval` still bails the pass. New `unused-trycatch`, `loop-header-patterns`, and `loop-pattern-emptied` fixtures pin the behavior in both output modes and envs (the emptied-pattern client files are frozen from the native output, documented as the intentional divergence).

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

### Patch Changes

- 34955e6: Support JSX fragments as component children in dom and universal modes. `<Comp><>...</></Comp>` previously failed with "Only text and expression component children are implemented in the AST-native milestone" in dom mode (while babel and ssr accepted it); fragments now lower through the shared fragment path and are hosted in a `children` getter like element children, matching Babel for sole fragments, fragments mixed with siblings, nested/empty fragments, dynamic and conditional fragment content, and keyed components. Single element/fragment children that lower to a setup IIFE now inline their body into the getter across dom, ssr, and universal modes (Babel's zero-arg callee unwrap), and ssr fragment children keep their `memo` wrapper instead of unwrapping it into the getter body.
- 8e9caec: Include imported bindings referenced only as plain JSX tags in the refresh transform's granular `dependencies`. The Babel plugin skips all plain JSX identifier tags in `getForeignBindings` — correct for same-module components (their `$$component` proxy gets a new identity on every re-execution, so counting them would remount everything on every edit) but wrong for imports: when an edit bubbles from the imported module to an importer, a component referencing the import only as a JSX tag had unchanged signature and dependency identities, so `patchComponent` skipped it and it kept rendering the stale module instance while sibling non-JSX references swapped to the new one (split-brain; a re-created context's old `Provider` staying mounted crashed readers with `ContextNotFoundError` and halted reactivity). Plain JSX tags now count as dependencies iff the identifier resolves to an imported binding — scope-aware, so component-local variables shadowing imports don't count, type-only imports are ignored, and member-expression tag roots (`<Foo.Bar/>`) still count unconditionally.
- 3f1a271: Dev-only source-name metadata for server functions, for dev tooling that inspects registered functions (e.g. a dev-toolbar server-function inspector) — today those surfaces can only label a function by its opaque hash id.
  - **Compiler**: in development (`env: "development"`), `transformDirectives()` emits the extracted function's descriptive source name as a trailing argument to the generated runtime calls — `registerServerReference(id, fn, name)` in server output, `createServerReference(id, name)` in client output. Name resolution matches the existing dev-ID suffix: the function's own name, else the binding/variable name it is assigned to, else the export name; anonymous inline extractions emit nothing. Production output is byte-identical to before — no extra argument, no name leakage — and the argument is trailing/optional, so out-of-band consumers of the ABI (manifests, frameworks) are unaffected.
  - **Runtime**: `registerServerReference` and `createServerReference` accept the optional trailing `name` (an `@internal` ABI parameter like the rest) and seed the reference's metadata channel with `{ name }` as a default — explicit `withMeta`/`GET` writes shallow-merge over it, so a user-provided `name` wins. `ServerFunctionMetadata` gains `readonly name?: string`: a dev-only human-readable label, not unique, not an identity key (use `id` for identity).

- fb4f798: Fix cross-mode dynamic-classification divergences from the Babel plugin by routing every generate through one shared classifier: the dom and universal generates now honor the namespace-import member carve-out (`import * as ns` member accesses classify as static, including computed members with static keys), `/*@static*/` markers are respected in dom fragment children, component children, and condition branches (and are leading-only everywhere, matching Babel's `leadingComments` check), fragment and element spread children (`<>{...items()}</>`) now compile with Babel's semantics in all modes instead of erroring in dom and silently losing reactivity in universal, and JSX inside a component spread argument no longer classifies as dynamic in universal mode (which previously produced a spurious `mergeProps` thunk).
- fb4f798: Unify the compiler's traversal/classification layer across the dom, ssr, and universal generates, mirroring babel-plugin-jsx's shared architecture: one `Classify` authority owns dynamic classification, child filtering/counting, and static-marker handling, and single generic implementations of fragment lowering, component children, and the component prop loop replace the per-mode copies (mode dispatch remains only at emission). Guardrails added: a cross-mode fixture-union parity ratchet and a classification-trace harness asserting all generates answer every shared classification question identically.

## 0.50.0-next.23

### Patch Changes

- 4a5e702: Add two new experimental, independent passes that port the remaining Babel transforms of the Solid toolchain's dev support pass to native:

  `transformLazy(code, options)` (and `transformLazyAsync`) — the `lazy()` module-URL pass from vite-plugin-solid's `lazy-module-url` plugin. Detects `lazy(() => import("specifier"))` calls where `lazy` is a named import from `solid-js` and appends the frozen `"__SOLID_LAZY_MODULE__:<specifier>"` placeholder argument that the bundler plugin's `resolveLazyModuleUrls` resolves afterwards. Verified against frozen outputs of the Babel reference across import-binding, shadowing, and non-matching edge cases.

  `transformRefresh(code, options)` (and `transformRefreshAsync`) — the solid-refresh HMR transform (solid-refresh@0.8.0-next.7, `jsx: false` mode as vite-plugin-solid invokes it). Supports the `bundler` (`esm`/`vite`/`webpack5`/`rspack-esm`/`standard`), `granular`, and `fixRender` options plus `@refresh skip`/`@refresh reload` pragmas, and emits the frozen runtime ABI (`$$registry`/`$$component`/`$$refresh`/`$$decline`) with bit-exact xxhash32 signature hashes — the native signature printer reproduces `@babel/generator`'s default print of the component so HMR state survives the Babel→native swap without spurious remounts. The runtime import source is configurable via `importSource` (default `"solid-refresh"`, byte-for-byte like the Babel plugin; override to `solid-js/refresh` for the in-core runtime). A frozen parity suite compares whole outputs and signature hashes against committed reference files generated from the actual Babel plugin, including printer torture fixtures.

  Not ported (rejected or documented): the plugin's `jsx: true` JSX-granularity mode (its standalone default; vite-plugin-solid always passes `jsx: false`), the typed-but-ignored `imports` option, and exotic TypeScript types inside component signatures fall back to raw source slices when printed.

  Deliberate divergences from the Babel plugin (inherited bugs fixed in the native pass):
  - solid-refresh#76 / vite-plugin-solid#145 — TypeScript declaration merging: the plugin rewrites `function A() {}` into `const A = $$component(...)`, which collides when a same-name `namespace A` merges with the function (esbuild rejects `const`/`var` + `namespace` outright, and the post-strip namespace IIFE conditionally assigns the binding, a TypeError under `const`). The native pass detects a same-name top-level value binding (namespace/module, enum, class, var) or a module-level write to the function's own binding and leaves that declaration untouched — a per-component `@refresh skip`: the component still renders, it just isn't hot-wrapped. Type-only merges (interfaces, type aliases, ambient declarations, overload signatures) are erased by the TS strip and still wrap.
  - solid-refresh#77 — member-expression refs (`ref={props.setRef}`) crashing with "Cannot set property which has only a getter": documented as unreachable rather than patched. The broken safe-wrap lives in the plugin's `jsx: true` extraction; under `jsx: false` — the only mode vite-plugin-solid uses and the only mode the native pass accepts — JSX is never rewritten and refs pass through verbatim. A pass-through fixture locks this in.

- 7bc90dc: Add `transformDirectives(code, options)` (and `transformDirectivesAsync`) — an experimental, incomplete port of the `"use server"` directive transform as a second, independent pass alongside the JSX transform. It applies to plain `.js`/`.ts` modules as well as JSX/TSX and follows the Babel reference implementation (vite-plugin-solid `src/server-functions/`, hoisted from SolidStart) with a fixture parity suite checking structural and naming parity.

  Covered so far: module-level `"use server"` (exported function declarations, const-assigned functions/arrows, aliased and default exports) in both server and client output modes, function-level `"use server"` on function expressions and arrows (including function declarations bubbled to `const` form), client-side dead-code elimination of server-only code, development-mode ID suffixes, and the frozen runtime ABI — `registerServerReference` / `createServerReference` imports from a configurable module and `xxhash32(relative path)-<count>` function IDs interchangeable with the Babel output. The result reports extracted function metadata (`{ id, name, exports }`) alongside `{ code, map, valid }` for bundler manifest building.

  Not yet ported: server functions nested inside other extracted server functions, object/class method directives, and sourcemap fidelity through the client DCE pass.

- 3d1e2f2: `transformDirectives` now validates closure captures at compile time. A function-level `"use server"` function may only reference its own parameters and locals (including nested function scopes within it), module top-level bindings (imports, top-level `const`/`let`/`var`/`function`/`class`), and true globals. Referencing a binding declared in an intermediate enclosing scope — an enclosing function's local or parameter, a loop variable, a catch parameter — previously extracted a function that silently lost the captured value; it is now a compile error naming the variable, the capture site, and the declaration site (e.g. ``src/module.ts:5:12: server functions cannot capture non-top-level variables: `secret` is declared in an enclosing function``). Module-level `"use server"` directives are unaffected, as are directives the transform never extracts (object/class methods, and functions nested inside an already-extracted server function).
- fa7c011: Fix scope resolution in the native JSX transform's binding classification. The binding table collected declarations into flat name-keyed lists that were never cleared when a scope closed, so an identifier in a JSX attribute could resolve to a same-named binding from an earlier, already-closed sibling scope (or fail to be shadowed by an inner declaration). A `ref={div}` whose `div` was a `let` in the enclosing function could be classified as const/function-like because an unrelated earlier callback declared `const div = ...` — emitting the `_$ref(...)`-only form (broken assignment at runtime) or, for stale literal bindings, silently inlining the value into the template. The same stale lookup affected resolvable event-handler detection, static value/boolean inlining of any attribute, style/classList folding, children text, and namespace-import spread classification.

  The binding table now keeps a scope stack synchronized with the traversal: statement lists open block frames, functions/arrows/static blocks open function frames, `var` declarations hoist out of block frames to the enclosing function frame, and lookups resolve the innermost live declaration like Babel's scope chain.

- d6ea225: `@dom-expressions/jsx-compiler` is now `@dom-expressions/compiler` (platform
  binary packages follow: `@dom-expressions/compiler-darwin-arm64`,
  `...-wasm32-wasi`, etc.). The compiler is growing beyond the JSX transform —
  directive extraction (`use server` and future directives) and other passes
  will live in the same binary, composing over a single parse — so the name no
  longer singles out one pass. The old packages will be deprecated on npm with
  a pointer to the new names; no API changes ride along with the rename. The
  native-binding escape-hatch env var follows the rename:
  `JSX_DOM_EXPRESSIONS_COMPILER_NATIVE` → `DOM_EXPRESSIONS_COMPILER_NATIVE`,
  and local build artifacts are now named `compiler.*.node` / `compiler.wasi.cjs`.
- 91efc41: More precise dead-code elimination after the `"use server"` client rewrite
  in `transformDirectives()` (kept in lockstep with the Babel reference
  implementation):
  - The shake is now scoped to bindings orphaned by the rewrite (names
    referenced from the replaced function bodies, cascading through removed
    declarations). Code that was already unreferenced before the transform —
    e.g. `const t = startTimer()` written for its side effect — is no longer
    deleted from client output.
  - Destructuring patterns are now shaken: `const { db } = createClient()`
    used only inside a server function is removed from the client build along
    with its now-unused imports, closing a server-code-leak hole. Array
    pattern elements become holes (or truncate the tail), rest elements and
    nested patterns cascade, and a declarator whose pattern empties is dropped
    entirely.
  - Modules containing a direct `eval(...)` call skip the shake (reference
    counts are unreliable there); the directive rewrite itself still applies,
    and a warning is logged in development mode.

## 0.50.0-next.22

## 0.50.0-next.21

## 0.50.0-next.20

## 0.50.0-next.19

### Patch Changes

- ff7818e: Install the WebAssembly compiler fallback automatically so StackBlitz and other environments without native addon support work without package-manager architecture configuration.

## 0.50.0-next.18

### Patch Changes

- abe0213: Add an optional WebAssembly compiler binding for StackBlitz WebContainers and other environments that cannot load native Node.js addons.

## 0.50.0-next.17

### Patch Changes

- 0847c13: Reach full output parity with babel-plugin-jsx across all modes. In dynamic (multi-renderer) mode, native elements belonging to another renderer are now routed to that renderer's transform instead of being templated as DOM (e.g. `<mesh>` inside a DOM subtree lowers through the universal renderer), DOM subtrees flatten their setup statements in statement position and single-child component getters, and shared wrapper helpers (`createComponent`, `mergeProps`, `applyRef`, `setProperty`) import once from the top-level module. JSX inside dynamic attribute values now lowers after the enclosing root completes, matching Babel's template registration order and effect getter wrapping. Dev hydratable mode fixes: intermediate element walks emit validated `getFirstChild`/`getNextSibling` lookups chained through walk variables, and nested elements no longer omit closing tags their position requires (e.g. `</li>` before a following sibling).
- 04a710f: Fix native JSX compiler output for delegated member-expression event handlers so emitted `addEvent(..., true)` calls are paired with `delegateEvents([...])` registration.
- 70fe7e7: Fix native JSX compiler insertion markers so dynamic child slots preserve their runtime position after surrounding static template content, including hydratable marker regions.
- bb7b2fd: Fix omitLastClosingTag corrupting templates when per-slot insertion markers follow the last static element. An element trailed by two or more dynamic slots now keeps its closing tag, so the trailing `<!>` placeholders parse as its siblings instead of being swallowed as children of the still-open element (which crashed the template walk with "Cannot read properties of null (reading 'nextSibling')").
- bab4c72: Align the native JSX compiler's DOM output with babel-plugin-jsx across a set of behavioral gaps found by the new compiler parity suite:
  - SVG/MathML partials (e.g. a top-level `<rect>` or `<mrow>`) are now wrapped in their owner tag and compiled with template flag `2`, and templates whose subtree needs `importNode` cloning (custom elements, `is` attributes, lazy-loading `img`/`iframe`) are flagged with `1`. The `xmlns` attribute used to detect the namespace is dropped from serialized templates.
  - Hydratable mode now honors `$ServerOnly` and skips templates for `html`/`head`/`body` document shells, resolving `html` children by tag via `getNextMatch`.
  - Hydratable dynamic slots adjacent to text now emit `<!$><!/>` marker pairs instead of client-only `<!>` placeholders, positional walks are hoisted ahead of inserts and chain from the previous marker's end node (root-relative paths could land inside SSR'd marker content), and closing tags are no longer omitted before hydration markers.
  - `runHydrationEvents()` is emitted once per template root after setup (including for spreads, which may carry delegated handlers) instead of after every delegated event assignment.
  - Dynamic `prop:*` attribute values are now wrapped in effects instead of being assigned once, comma/sequence expressions in child positions are treated as dynamic, and the `/*@static*/` marker is respected on inserted child expressions.

- 0847c13: Close the remaining configuration gaps between the AST-native compiler and the babel plugin:
  - `effectWrapper` and `memoWrapper` now accept custom import names (babel's string form): `effectWrapper: "createRenderEffect"` imports and calls `createRenderEffect` instead of `effect`. `false` (or `""`) still disables the wrapper. The options no longer need to be disabled as a pair — `wrapConditionals: false`, `effectWrapper: false`, and `memoWrapper: false` each work independently, matching babel. With `memoWrapper: false`, conditions compile memo-less (plain thunks) and SSR component children in multi-child arrays unwrap to their bodies, identical to the babel plugin.
  - `requireImportSource` is implemented: when set, only files carrying a `@jsxImportSource <source>` comment are transformed (same comment-splitting match as babel — the comment's remainder after `@jsxImportSource` must equal the configured source exactly); other files return their source text untouched.
  - `validate` is implemented (default `true`, like babel): DOM template markup is re-parsed with a spec HTML parser (html5ever, the Rust counterpart of the babel plugin's parse5) and a warning is printed to stderr when a browser's `innerHTML` would restructure the markup (implied end tags, foster parenting, nested `<a>`/`<form>`/`<button>`, misplaced hydration markers). Warning text, text-node normalization, table-partial wrapping, and the skip list match the babel plugin's `isInvalidMarkup`.
  - `inlineStyles: false` parity in spreads: a `style` on a native element with spread attributes now wraps in the same IIFE getter babel produces (previously it could land as a plain static prop), and a `/*@static*/` marker on a style stops applying under `inlineStyles: false` because the rewrap discards the original node (babel behavior).

  An option-matrix parity suite now compiles the whole fixture corpus under each flag flipped from its default (150 mode × variant combinations) and requires identical normalized output from both compilers, with no exclusions.

- 0847c13: Rewrite the native compiler's DOM attribute pipeline to match the Babel plugin's output:
  - Dynamic attribute bindings across a whole template root now batch into a single `effect()` with a previous-values object, instead of one effect per attribute.
  - Stateful DOM properties (`input.value`/`checked`, `select.value`, `option.value`/`selected`, `video`/`audio` `muted`, and their `default*` forms) compile to inlined attributes when static and `prop:` property writes when dynamic, including the `<select value>` `queueMicrotask` race guard and the input/textarea nullish-value fallback.
  - Class and style attributes go through the full preprocessing pipeline: static styles merge into the template, style objects split into `setStyleProperty()` calls, class arrays and fixed-shape class objects split into static classes and `classList.toggle()` bindings, and duplicate attributes dedupe last-wins.
  - Dynamic `textContent` writes to a dedicated placeholder text node's `data` instead of assigning `textContent`.
  - Refs follow the Babel branch order (constant bindings call `ref()` directly; lvalues get the callable-check with assignment fallback), and delegated event handler groups emit as flat statements ahead of other element expressions.
  - Confident compile-time evaluation folds template literals, arithmetic, logical/conditional expressions, and static bindings into literals, matching Babel's `path.evaluate()` usage.

- 99ce3b2: Port the ssr spread-path hydration id fixes (#540) to the native compiler: dynamic children holes of spread elements (`<a {...props}>{children()}</a>`) are now scope-wrapped so they evaluate under their own owner scope, and hydratable spread props defer `mergeProps` behind a thunk so `ssrElement` allocates the element's hydration key before dynamic props run — previously every hydration id following the hole drifted, leaving siblings unclaimed.
- 0847c13: Port the Babel plugin's attribute preprocessing pipeline to the native compiler and share it across DOM, SSR, and universal outputs. Attribute handling now matches babel-plugin-jsx: duplicate attributes deduplicate to the last value, multiple `class` attributes merge, static `style`/`classList` objects split and fold into the template, confidently-evaluable expressions (including conditionals and logicals over known constants) inline as static attribute text, dynamic attribute updates batch into a single effect with previous-value tracking, and `textarea` `value` folds into element children where Babel does. SSR output gains the same planning: `textContent`/`innerHTML` become element children instead of literal attributes, reserved namespaces (`prop:`, `on*`, `use:`, `bool:`, etc.) are handled consistently, and hydratable `textContent` gets the `|| " "` guard.
- 0847c13: Align the AST-native compiler's handling of JSX nested inside attribute values, event handlers, refs, spreads, and component props with the babel plugin. Nested JSX now lowers after the enclosing root finishes (matching babel's deferred re-traversal), so template declaration order matches babel output, setup statements inline into prop/spread getter bodies instead of wrapping in an IIFE (including in universal mode), and SSR temp variables hoist into the nearest enclosing closure rather than module scope — as a parameter when the closure is a zero-arg IIFE, mirroring babel.

  `this` handling is now a full port of babel's `transformThis`: `this` in any embedded expression or JSX tag name (`<this.Component/>`) resolves through the captured `_self$` alias, `this` inside nested non-arrow functions and classes is left untouched, and the capture placement follows the JSX root's function parent — inserted before the statement in class methods, hoisted to the top of plain/arrow function bodies, and wrapped around the result expression at top level and in class field initializers.

  Additional parity fixes uncovered by adversarial probing:
  - JSX initializers inside `export const` and multi-declarator `var`/`let`/`const` statements now lower in statement position (setup statements inserted before the declaration) instead of bailing to an IIFE.
  - SSR temp variable (`_v$`) placement is a full port of babel's `Scope.push` targeting: variables hoist to the nearest enclosing block, switch statements redirect to the function parent, default-parameter positions resolve outside the function, and multiple hoists in one scope emit a single combined `var` declaration.
  - `class:`/`style:`/`use:`/`attr:`/`bool:` are no longer treated as reserved namespaces (matching the 0.50 babel plugin, which only reserves `prop:`) — in SSR they now pass through as literal attribute names instead of being stripped to their suffix.
  - `contextToCustomElements` now defaults to `false`, matching the babel plugin.
  - Multiple delegated events on one element emit their `addEventListener`/delegation setup in babel's (reverse-source) order.
  - HTML entity decoding in text and attribute values covers the full WHATWG named-entity set instead of the five basic entities.
  - `ref` values bound to `const` function declarations use the direct call shortcut instead of the `typeof` fallback, matching babel's constant-binding check.
  - Dynamic mode now rejects a native element nested directly under another renderer's native element (`<circle>` inside a dom `<div>`, or vice versa) with the same "not supported in" error the babel plugin throws, instead of silently compiling the child into the wrong renderer's template.
  - Static child-expression folding matches babel's `getStaticExpression`: `{true}`/`{false}`/`{null}` are no longer folded into template text (they compile to inserts, like babel), while `NaN`, `Infinity`, unary `-`/`+` numbers, and evaluable template literals now fold statically. `String(number)` spellings for `NaN`/`Infinity` are used in templates.
  - Positional child walks chain from the most recently declared walk variable (babel's `tempPath`) instead of re-deriving root-relative `firstChild.nextSibling…` paths — required for correctness in dev hydratable mode, where the previous walk can be a `getFirstChild` call a root-relative path cannot express.
  - Generated locals (`_el$`, `_tmpl$`, `_v$`, `_ref$`, `_self$`, `_c$`, `_g$`) now skip names already used anywhere in the source (babel's `generateUid` collision loop) instead of emitting duplicate declarations that fail to parse.
  - Namespaced attributes on components (`<Comp ns:x={v}/>`) compile to literal `"ns:x"` prop keys instead of erroring.
  - Dynamic `textContent` on an element that also has children keeps the children in the template (babel's `!hasChildren` gate) instead of replacing them with the single-space placeholder.
  - `typeof <literal>` folds statically in both child and attribute positions (babel's `path.evaluate()` handles `typeof`).
  - The hydratable `scope()` wrap around deferred child slots now keys off babel's full deep `isDynamic` check, so holes whose dynamism hides under a unary/other wrapper expression (`{!cond() ? <i/> : <u/>}`) are scoped correctly.
  - Non-dynamic fragment children emit their raw expression (`<>{"static"}</>` → `"static"`) instead of registering an SSR template, matching babel (whose `getStaticExpression` never folds fragment children).
  - Multiple `ref` attributes on one universal element emit in babel's (reverse-source, `unshift`) order.
  - Universal mode now applies babel's `evaluateAndInline`: confidently evaluable attribute values (const references, `typeof`, arithmetic) fold to literals in `createElement` props.
  - Built-in component aliasing (`builtIns`) is now scope-aware, matching babel's `scope.hasBinding` gate: a function/arrow/destructured parameter, loop-head binding, or declaration anywhere in the tag's scope chain (including after the use — scope registration is position-insensitive) suppresses the auto-import, while bindings in sibling functions, inner blocks, or catch clauses the tag isn't inside no longer do.
  - The object of a member-expression tag (`<For.Item>`) is never built-in-aliased, matching babel's identifier-only check.
  - In dynamic mode, built-in auto-imports resolve against the top-level module instead of the renderer module a native parent routed through, and the same built-in used by both renderers dedupes to a single import.
  - An SSR module whose only compiler output is a built-in auto-import no longer drops the import.
  - SSR temp variables hoisted from a single-statement loop body (`for (x of l) push(<jsx/>)`) blockify the body and declare inside it (loops are block parents in babel's scope model) instead of hoisting to the function top.

## 0.50.0-next.16

### Patch Changes

- 04849df: Preserve JS value semantics for wrapped `&&` conditions (#532). The dom generate's condition wrap used to emit `memo(() => !!left)() && right`, collapsing every falsy left value to `false` — visibly wrong for component props (`undefined` became `false`, breaking `== null` checks) and a hydration mismatch against the untransformed server output (`{0 && <div/>}` rendered "0" on the server, nothing on the client). `left && right` is exactly `left ? right : left`, so the wrap now emits `memo(() => !!left)() ? right : left`: branching still keys off the memoized truthiness (truthy-value churn never re-creates the right side) while the alternate returns the raw left, matching the server for free. Statically boolean lefts (comparisons, `!x`) keep the plain `memo(() => left)() && right` form — the memo's value is the expression's value, so it's already exact with no second evaluation. Ported identically to the Rust jsx-compiler.
- bb7470e: Give every dynamic child slot its own insertion marker when a parent hosts more than one (solidjs/solid#2830). Adjacent expression slots used to share a marker (`null` at the tail, a shared following sibling, or one reused `<!>` between text), which collapsed them into a single `$$SLOT` ownership region: a node migrating between adjacent slots was destroyed by the slot it left, arrays exchanging members could throw `NotFoundError`, and a slot emptied via `[]` refilled at the wrong position. Slots in multi-slot parents now ride the immediately following static sibling or get a dedicated `<!>` placeholder — the same per-slot geometry hydratable output has always produced, which is why these shapes already worked after hydration. Zero runtime changes; single-slot parents compile byte-identically to before.
- 4f00432: Port the hole id-scope design from the Babel plugin: deferred child holes that can allocate hydration ids are wrapped in `scope()` on both the dom and ssr generates (shared `child_slot_allocates_ids` + dynamic predicates so the generates can't desync), replacing the old `orderedInsert` sibling-thunking machinery. Bare getters simplified from `{sig()}` are re-wrapped as `() => sig()` on the dom side so tagging the scope doesn't mutate the user's function.
- 668264f: Universal JSX now passes compile-time static host props to `createElement(tag, staticProps)` so custom renderers can configure nodes before children are inserted. Dynamic props and elements with spreads continue to use the existing `setProp` / `spread` paths.

## 0.50.0-next.15

### Patch Changes

- dc546f3: Add initial AST-native DOM support for plain dynamic attributes by lowering them through reactive effects and `setAttribute`. The compiler now also supports the full Babel DOM `attributeExpressions` fixture, including DOM child-property, style, class/className, state-property, ref, `prop:*`, and spread attribute lowering.

  The Oxc DOM slice now supports inline event handlers for delegated and native events, follows Babel's updated removal of `on:` namespace-event handling, supports `delegateEvents` / `delegatedEvents` configuration, mirrors the Babel/runtime constants needed for void elements, child properties, namespaces, delegated events, and DOM state-property classification, honors Babel-style `omitLastClosingTag` / `omitNestedClosingTags`, `omitQuotes`, `omitAttributeSpacing`, `inlineStyles`, `effectWrapper: false`, paired `wrapConditionals: false` / `memoWrapper: false` wrapperless mode, `requireImportSource`, `staticMarker`, and `validate` template/update options, lowers known namespaced DOM attributes such as `xlink:href` through `setAttributeNS`, covers additional full Babel DOM fixtures including `components`, `SVG`, `conditionalExpressions`, `customElements`, `fragments`, `insertChildren`, `multipleClassAttributes`, and `SVGComponentPartial`, adds parseable `namespaceElements` coverage, supports Solid-compatible custom element context capture through `contextToCustomElements`, adds Babel-aligned `memo` predicate lowering for DOM conditional children and component props plus fragment/component child dynamic expressions, wraps dynamic DOM child member/call/optional/nullish expressions like Babel, handles optional-chain component children and nested fragment conditionals with Babel-shaped getters, memo wrappers, and empty-fragment arrays, supports hydratable DOM fixture output through `getNextElement` template roots, replays queued hydratable delegated events through `runHydrationEvents`, supports dev hydratable DOM validation walks through `getFirstChild` / `getNextSibling`, starts SSR mode with native element/text lowering through `ssr`, dynamic text interpolation through `escape`, plain dynamic native attributes through `escape(..., true)`, hydratable root template keys through `ssrHydrationKey`, defers later hydratable SSR child slots that allocate hydration IDs after deferred children, full coverage for all checked-in Babel SSR and SSR hydratable fixture families, begins universal mode with native elements, static attributes, dynamic text insertion, component calls through shared prop assembly, spread attributes, spread children, and full coverage for the currently checked universal fixtures, adds dynamic mode with DOM-renderer routing, universal fallback, and hybrid DOM/universal dispatch while avoiding duplicate helper import aliases, validates the supported compiler option surface so non-default unsupported Babel options throw instead of being silently ignored, updates the public README and TypeScript declarations for the current option surface, splits SSR/universal target helpers into submodules, shares common AST construction helpers across targets, and expands component lowering with member-expression prop getters, `@static` opt-out, JSX child arrays, dynamic child getters, configured `builtIns` imports, spread props through `mergeProps`, JSX member component callee construction, component ref normalization for identifier/static/simple optional/call/computed refs, return-statement JSX setup lowering, getter setup lowering, and `this` capture for supported class method/field JSX.

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
