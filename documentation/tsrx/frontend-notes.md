# TSRX Frontend — Stage 0 Findings

Research notes for adding a TSRX syntax frontend to `@solidjs/babel-plugin` and
`@solidjs/compiler`. The lowering rules below were verified by running
`@tsrx/solid` (the official Solid target, our semantic oracle) against real
samples, then cross-checked against this repo's current 2.0 RC APIs.

## Version pins

| Dependency         | Pin                                                                 | Notes                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TSRX specification | Draft / June 7, 2026 (first edition)                                | Snapshot in `tsrx-specification-snapshot.md`                                                                                                           |
| `@tsrx/core`       | 0.1.61                                                              | Official parser (acorn + `@sveltejs/acorn-typescript` + TSRXPlugin). ESTree AST + TSRX nodes. Babel-side parser.                                       |
| `@tsrx/solid`      | 0.1.61                                                              | Oracle only — we do not port it. Peer-deps `solid-js`/`@solidjs/web` `2.0.0-beta.15`.                                                                  |
| `oxc-tsrx`         | rev `6be6a8c7773407c84f79fad0e3f7d192b72e8102` (v0.6.0, 2026-08-23) | Rust-side parser. Git dependency (not on crates.io): crates `tsrx_parser_engine`, `tsrx_syntax`, `tsrx_tape_schema`, `oxc_adapter` (feature `parser`). |

### Oxc duplication

`oxc-tsrx` pins oxc to git rev `8e0ed2eb…` (= oxc **0.140.0**); our compiler
uses crates.io **0.144**. No oxc types cross the conversion boundary —
`TsrxParseResult.program` is a `FlatTape` from `tsrx_tape_schema`, which is
explicitly _revision-neutral and OXC-independent_ — so the two copies coexist.
Cost is compile time and binary size; revisit if `oxc-tsrx` upstreams into oxc.

### Parse result shapes

- **Babel side:** `parseModule(source, filename, options)` → ESTree `Program`
  with TSRX nodes (`JSXCodeBlock`, `JSXIfExpression`, `JSXForExpression`,
  `JSXSwitchExpression`, `JSXTryExpression`, `JSXStyleElement`);
  `analyzeTsrx(ast, filename, options)` for target-neutral validation.
- **Rust side:** `parse_tsrx(&TsrxParseRequest)` → `TsrxParseResult` whose
  `program` is a `FlatTape` (flat record encoding mirroring the same ESTree+TSRX
  shapes; built for `@tsrx/core` AST compatibility). Diagnostics come back in a
  `DiagnosticTable`. The canonical route is ASCII-only; `parse_tsrx_utf16` is
  the fallback route for non-ASCII sources.

Both frontends therefore walk the **same logical AST**; the desugaring below is
specified once and implemented twice.

## Lowering contract (oracle-verified, adapted to 2.0 RC)

All flow-control imports come from `solid-js`; `dynamic` from `@solidjs/web`.

| TSRX                                                  | Lowering                                                                                                           | Verified oracle output                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `@{ body; render }` as function body                  | Inline statements + `return render`                                                                                | yes                                                    |
| `@{ body; render }` in expression/child position      | IIFE `(() => { body; return render; })()`                                                                          | yes                                                    |
| `@if (c) { A }`                                       | `<Show when={c}>A</Show>`                                                                                          | yes                                                    |
| `@if (c) { A } @else { B }`                           | `<Show when={c} fallback={B}>A</Show>`                                                                             | yes                                                    |
| `@if / @else if / … / @else` (chain)                  | `<Switch fallback={else}>` + `<Match when={cN}>` per branch                                                        | yes                                                    |
| `@for (const x of expr; index i; key k(x))`           | `<For each={expr} keyed={(x) => k(x)}>{(x, i) => …}</For>`                                                         | yes — RC `For` has the `keyed: (item) => any` overload |
| `@empty { F }`                                        | `fallback={F}` on `For`                                                                                            | yes                                                    |
| `@switch (v) { @case 'a': {A} @default: {D} }`        | `<Switch fallback={D}><Match when={v === 'a'}>A</Match>…</Switch>`                                                 | yes                                                    |
| `@try { C } @pending { P } @catch (e, reset) { E }`   | `<Errored fallback={(e, reset) => E}><Loading fallback={P}>C</Loading></Errored>`                                  | yes, with one adaptation (below)                       |
| `<{expr}>…</{expr}>`                                  | `const TsrxDynamic_N = dynamic(() => expr)` hoisted into scope, used as component                                  | yes                                                    |
| `{name}` prop shorthand                               | `name={name}`                                                                                                      | yes                                                    |
| `let/const &{ a, b } = expr`                          | `__lazyN = expr`; reads become `__lazyN.a`                                                                         | yes                                                    |
| Nested/renamed/computed lazy bindings and `= default` | Deferred access chain; defaults apply only for `undefined`, evaluate lazily, and read the member once              | yes                                                    |
| `&{ selected, ...rest }`                              | Per-read reactive `omit(__lazyN, "selected")` view                                                                 | yes; the rest binding is read-only                     |
| `let &[a, b, ...rest] = expr`                         | Indexed reads plus a fresh `Array.from(__lazyN).slice(2)` rest view per read — **no getter auto-calling**          | yes; the rest binding is read-only                     |
| `&{ a }` in function or arrow params                  | `__lazyN` param (type annotation/default preserved), member reads                                                  | yes; sync, async, multi-parameter, and generic arrows  |
| Scoped `<style>` blocks                               | Removed from JSX; scoped/pruned CSS returned separately and matching native/dynamic elements receive `tsrx-<hash>` | yes; Babel metadata and native result expose CSS/hash  |
| Native TSRX source maps                               | Compose codegen mappings through exact authored projection ranges; generated-only ranges remain unmapped           | yes; original filename/source content preserved        |
| Guard `if (!x) return null;` before render            | Preserved as ordinary statements                                                                                   | yes                                                    |

### Deliberate adaptation: `@catch` error binding

`@tsrx/solid` emits `fallback={(e, reset) => …e.message…}` — a **raw** `e`
read, written against beta.15. In the current RC, `Errored`'s fallback receives
`err: ErrorAccessor` (a function). Our frontend rewrites reads of the catch
binding to calls (`e()` → `e().message`), consistent with the deferred-access
treatment of `&` bindings. Report upstream to `@tsrx/solid`.

### Stage 2 findings (Babel frontend implementation)

- **`analyzeTsrx` does not enforce template escape rules.** Return/break/
  continue rejection inside `@if`/`@for`/`@switch`/`@try` blocks lives in the
  platform transform layer upstream, not the shared analyzer. Our desugarer
  enforces it (`validateNoControlFlowEscape`), reusing `@tsrx/solid`'s exact
  messages for `@if`/`@for` and uniform equivalents for the other constructs.
  These messages are part of the parity contract the Rust frontend mirrors.
- **The previous lazy engine hijacked intrinsic tags (upstream bug,
  @tsrx/core 0.1.61).**
  `rewrite_lazy_jsx_name` rewrites _any_ JSX name matching a lazy binding —
  `<address>` with `const &{ address } = user` in scope becomes
  `<__lazy0.address>`, turning an element into a component. Per JSX semantics
  a single lowercase identifier tag is always intrinsic. The Solid-local
  engine never performs that rewrite; `restoreIntrinsicJsxNames` remains as a
  compatibility repair for trees produced by older paths.
- **Ordering: desugar before lazy.** The lazy engine only collects block-level
  `let &[…]`/`const &{…}` bindings in its BlockStatement/Program handlers,
  which never fire while function bodies are still `JSXCodeBlock` nodes. The
  frontend therefore desugars first (containers become real blocks), then runs
  preallocate + apply on the plain tree. Lazy patterns pass through the
  desugarer untouched.
- **Solid-local lazy lowering.** The Babel frontend no longer delegates lazy
  rewriting to `@tsrx/core`. Both frontends implement the same lowering for
  nested and computed paths, defaults, and object/array rest. Defaults use
  JavaScript's `=== undefined` rule, evaluate the fallback only when needed,
  and preserve direct source writes and prefix/postfix update results.
  Bindings below an ancestor default and rest views are read-only; attempting
  to write them produces a structured diagnostic instead of targeting an
  invalid raw path.
- **RC `For` accessor semantics (adaptation).** With a `keyed` function the
  children callback receives the item as an _accessor_, and the index
  parameter is an accessor in all modes: the desugarer rewrites reads of the
  item binding (keyed only) and the index binding to calls, scope-aware.
  Destructured keyed bindings become synthetic lazy parameters backed by that
  accessor, so nested/defaulted/computed/rest reads remain deferred when a row
  with the same key receives a replacement item.
- **RC `@catch` accessor semantics (adaptation).** Identifier error bindings
  rewrite to accessor calls. Object and array patterns become synthetic lazy
  parameters backed by the `ErrorAccessor`, preserving defaults, computed
  keys, rest views, and the current error value without eager destructuring.
- **Dynamic tags lower to the `Dynamic` builtIn** (`<Dynamic component={expr}
…>`), not `@tsrx/solid`'s hoisted `dynamic()` factory — semantically
  equivalent (web's `Dynamic` wraps `dynamic()`), uniform with the other
  builtIn lowerings, and simpler to mirror byte-for-byte in Rust.

### Stage 3 architecture (revised from the plan, user-confirmed)

The plan's "walk `TsrxParseResult` → build `oxc_ast`" assumed a reusable
tape→AST bridge. There is none: the `FlatTape` is a generic JSON record store
of the _entire_ ESTree program, and `oxc_adapter` only serializes the other
direction (`oxc_ast` → tape, for NAPI transfer). Building `oxc_ast` from the
tape would mean a full-language ESTree deserializer against oxc 0.144 with a
per-upgrade sync burden.

Revised architecture — **desugared text projection** (the same technique
`oxc-tsrx` uses internally in `projection/` + `reconstruct/`):

1. `tsrx_parser_engine::parse_tsrx` (pinned rev) parses and validates the
   TSRX source — the only TSRX grammar authority on the Rust side; its
   diagnostics surface as-is; unsupported syntax fails closed.
2. Walk the tape to locate TSRX constructs and their clause spans; emit a
   projected TSX source: original bytes verbatim outside constructs, the
   Babel frontend's exact desugared Solid-JSX form inside (contract frozen by
   the Stage 2 fixture snapshots). Escape-rule validation (return/break/
   continue) happens here with the same messages as the Babel frontend.
3. Parse the projection with our crates.io oxc 0.144; run the existing
   dom/ssr/universal transforms unchanged.
4. Lazy `&` bindings: rewrite during projection (pattern → `__lazyN`,
   deterministic ids matching `@tsrx/core`'s `generate_lazy_id`), with reads
   rewritten scope-aware to match `applyLazyTransforms` output.
5. Record an affine offset map for every verbatim-copied range. Native source
   maps compose Oxc's generated-JavaScript → projected-TSX tokens through this
   map to authored TSRX coordinates. Generated projection gaps emit source-less
   tokens so preceding authored mappings cannot bleed across compiler-created
   scaffolding, mirroring upstream `projection/mapping.rs`'s fail-closed policy.

### Known upstream gaps (pin in fixtures)

- **Arrow-function lazy params:** supported by both parser frontends, including
  synchronous, asynchronous, typed, defaulted, nested, multi-parameter, and
  generic arrows. Until the upstream parser changes are released, local
  verification uses the corresponding pinned revisions.
- `@tsrx/core`'s `transform/lazy.js` is an exported framework-agnostic
  AST-to-AST lazy transform (`create_lazy_context`, `preallocateLazyIds`,
  `applyLazyTransforms`, deterministic `__lazyN` naming). The Babel frontend
  reuses it on the ESTree AST before conversion; the Rust frontend replicates
  the same algorithm so generated names match byte-for-byte.
- **Expression-position statement containers:** the v0.6.0 parser gap was
  fixed in [tsrx-org/oxc#34](https://github.com/tsrx-org/oxc/pull/34).
  The native frontend now accepts the same function-body, statement,
  expression (`const x = @{…}`), direct JSX-child, JSX attribute, and JSX
  expression-container placements as `@tsrx/core`. The `codeBlocks` and
  `lazyShadowing` fixtures run through both compilers.

## Frontend architecture (both compilers)

1. Route: `syntax: "jsx" | "tsrx" | "auto"` option; `auto` selects TSRX for
   `.tsrx` filenames. TSRX machinery is lazily loaded / feature-gated so JSX
   paths are untouched.
2. Parse with the foreign parser (`@tsrx/core` / `oxc-tsrx`).
3. One conversion walk producing the compiler's native AST (Babel AST /
   `oxc_ast` 0.144) with TSRX nodes desugared per the contract above,
   preserving source locations.
4. Existing shared lowering (`shared/` + `dom`/`ssr`/`universal`) runs
   unchanged; builtIns handling picks up `Show`/`For`/`Switch`/`Match`/
   `Errored`/`Loading` as usual.
