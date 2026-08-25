# TSRX Frontend — Stage 0 Findings

Research notes for adding a TSRX syntax frontend to `@solidjs/babel-plugin` and
`@solidjs/compiler`. The lowering rules below were verified by running
`@tsrx/solid` (the official Solid target, our semantic oracle) against real
samples, then cross-checked against this repo's current 2.0 RC APIs.

## Version pins

| Dependency | Pin | Notes |
| --- | --- | --- |
| TSRX specification | Draft / June 7, 2026 (first edition) | Snapshot in `tsrx-specification-snapshot.md` |
| `@tsrx/core` | 0.1.61 | Official parser (acorn + `@sveltejs/acorn-typescript` + TSRXPlugin). ESTree AST + TSRX nodes. Babel-side parser. |
| `@tsrx/solid` | 0.1.61 | Oracle only — we do not port it. Peer-deps `solid-js`/`@solidjs/web` `2.0.0-beta.15`. |
| `oxc-tsrx` | rev `6be6a8c7773407c84f79fad0e3f7d192b72e8102` (v0.6.0, 2026-08-23) | Rust-side parser. Git dependency (not on crates.io): crates `tsrx_parser_engine`, `tsrx_syntax`, `tsrx_tape_schema`, `oxc_adapter` (feature `parser`). |

### Oxc duplication

`oxc-tsrx` pins oxc to git rev `8e0ed2eb…` (= oxc **0.140.0**); our compiler
uses crates.io **0.144**. No oxc types cross the conversion boundary —
`TsrxParseResult.program` is a `FlatTape` from `tsrx_tape_schema`, which is
explicitly *revision-neutral and OXC-independent* — so the two copies coexist.
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

| TSRX | Lowering | Verified oracle output |
| --- | --- | --- |
| `@{ body; render }` as function body | Inline statements + `return render` | yes |
| `@{ body; render }` in expression/child position | IIFE `(() => { body; return render; })()` | yes |
| `@if (c) { A }` | `<Show when={c}>A</Show>` | yes |
| `@if (c) { A } @else { B }` | `<Show when={c} fallback={B}>A</Show>` | yes |
| `@if / @else if / … / @else` (chain) | `<Switch fallback={else}>` + `<Match when={cN}>` per branch | yes |
| `@for (const x of expr; index i; key k(x))` | `<For each={expr} keyed={(x) => k(x)}>{(x, i) => …}</For>` | yes — RC `For` has the `keyed: (item) => any` overload |
| `@empty { F }` | `fallback={F}` on `For` | yes |
| `@switch (v) { @case 'a': {A} @default: {D} }` | `<Switch fallback={D}><Match when={v === 'a'}>A</Match>…</Switch>` | yes |
| `@try { C } @pending { P } @catch (e, reset) { E }` | `<Errored fallback={(e, reset) => E}><Loading fallback={P}>C</Loading></Errored>` | yes, with one adaptation (below) |
| `<{expr}>…</{expr}>` | `const TsrxDynamic_N = dynamic(() => expr)` hoisted into scope, used as component | yes |
| `{name}` prop shorthand | `name={name}` | yes |
| `let/const &{ a, b } = expr` | `__lazyN = expr`; reads become `__lazyN.a` | yes |
| `let &[a, b] = expr` | `__lazyN = expr`; reads become `__lazyN[0]` / `__lazyN[1]` — **no getter auto-calling** | yes (signal tuple: `__lazy0[0]` inserted as function child, unwrapped reactively at runtime) |
| `&{ a }` in function-declaration params | `__lazyN` param (type annotation preserved), member reads | yes |
| `<style>` | Deferred in v1 → structured diagnostic. (Oracle: hashed class `tsrx-<hash>`, `css` field on result, static-element hoisting.) | yes (for reference) |
| Guard `if (!x) return null;` before render | Preserved as ordinary statements | yes |

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
- **Lazy engine hijacks intrinsic tags (upstream bug, @tsrx/core 0.1.61).**
  `rewrite_lazy_jsx_name` rewrites *any* JSX name matching a lazy binding —
  `<address>` with `const &{ address } = user` in scope becomes
  `<__lazy0.address>`, turning an element into a component. Per JSX semantics
  a single lowercase identifier tag is always intrinsic; the frontend reverts
  such rewrites (`restoreIntrinsicJsxNames`). Report upstream.
- **Ordering: desugar before lazy.** The lazy engine only collects block-level
  `let &[…]`/`const &{…}` bindings in its BlockStatement/Program handlers,
  which never fire while function bodies are still `JSXCodeBlock` nodes. The
  frontend therefore desugars first (containers become real blocks), then runs
  preallocate + apply on the plain tree. Lazy patterns pass through the
  desugarer untouched.
- **RC `For` accessor semantics (adaptation).** With a `keyed` function the
  children callback receives the item as an *accessor*, and the index
  parameter is an accessor in all modes: the desugarer rewrites reads of the
  item binding (keyed only) and the index binding to calls, scope-aware, same
  as the `@catch` `ErrorAccessor` adaptation. `key` combined with a
  destructured loop binding is rejected in v1 with a structured diagnostic.
- **Dynamic tags lower to the `Dynamic` builtIn** (`<Dynamic component={expr}
  …>`), not `@tsrx/solid`'s hoisted `dynamic()` factory — semantically
  equivalent (web's `Dynamic` wraps `dynamic()`), uniform with the other
  builtIn lowerings, and simpler to mirror byte-for-byte in Rust.

### Stage 3 architecture (revised from the plan, user-confirmed)

The plan's "walk `TsrxParseResult` → build `oxc_ast`" assumed a reusable
tape→AST bridge. There is none: the `FlatTape` is a generic JSON record store
of the *entire* ESTree program, and `oxc_adapter` only serializes the other
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
5. Diagnostics after projection translate spans back through an affine offset
   map (verbatim-copied ranges only), mirroring upstream `projection/mapping.rs`.

### Known upstream gaps (pin in fixtures)

- **Arrow-function lazy params:** `(&{ a }) => …` fails to parse in
  `@tsrx/core` 0.1.61 (`Unexpected token`), though the docs show it and
  function-declaration params work. Our behavior follows `@tsrx/core` (the
  canonical parser); fixtures must assert `oxc-tsrx` rejects it identically —
  this is exactly the class of drift the parity corpus exists to catch.
- `@tsrx/core`'s `transform/lazy.js` is an exported framework-agnostic
  AST-to-AST lazy transform (`create_lazy_context`, `preallocateLazyIds`,
  `applyLazyTransforms`, deterministic `__lazyN` naming). The Babel frontend
  reuses it on the ESTree AST before conversion; the Rust frontend replicates
  the same algorithm so generated names match byte-for-byte.
- **Expression-position statement containers (`oxc-tsrx` v0.6.0, Stage 3
  finding, user-ruled: document the limitation):** the engine parses `@{}`
  containers as function bodies (`function C() @{…}`), arrow bodies
  (`() => @{…}`), and direct JSX children (`<div>@{…}</div>`), but not in
  expression position (`const x = @{…}`, `{@{…}}` inside a JSX expression
  container) — spec §4.4 allows all of these and `@tsrx/core` parses them.
  Root cause: the engine's scanner recognizes the token
  (`StructuralKind::FunctionBody` in `parser_scanner/region.rs`) but its
  projection replaces `@{` with a bare `{`, which in expression position
  parses as an object literal and fails (`Expected ':' but found
  'Identifier'`); a fix needs a new projection/reconstruction lane upstream.
  Consequences:
  - The native compiler rejects these forms with a structured diagnostic
    ("TSRX statement containers in expression position are not yet
    supported…", `src/tsrx/mod.rs::expression_position_container` — a
    post-failure heuristic on the preceding token).
  - DOM fixtures `codeBlocks` and `lazyShadowing` are Babel-only; the Rust
    suite pins their rejection
    (`tests/tsrx_frontend.rs::EXPRESSION_POSITION_FIXTURES`) so the corpus
    split is loud, not silent.
  - Upstream issue draft (for github.com/compiled-run/oxc-tsrx):
    *"Statement containers in expression position fail to parse. `const x =
    @{ const y = 1; <span>{y}</span> };` and `<div>{@{ … }}</div>` report
    `Expected ':' but found 'Identifier'` because the parser projection maps
    `@{` to `{`, which is an object literal in expression position. Function
    bodies, arrow bodies, and direct element children work. TSRX spec §4.4
    lists 'an expression position' among valid container positions, and
    `@tsrx/core` accepts these forms. Repro: v0.6.0,
    `parse_tsrx(&TsrxParseRequest { source })`."*

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
