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

## Author tooling contract

The runtime compiler does not parse source on behalf of editor or lint tools.
Experimental TSRX support therefore has three coordinated, independently
versioned paths:

1. `@solidjs/vite-plugin` selects the Babel or native Solid runtime compiler.
2. `@tsrx/typescript-plugin` currently uses `@tsrx/solid`'s
   `compile_to_volar_mappings` entry for editor services and `tsrx-tsc`.
   `@solidjs/compiler` now also exposes a host-independent
   `projectTsrxForTypecheck` foundation: compiler-owned post-rewrite TSX, an
   authored source map, style sidecars, and parser-authored embedded regions.
   Generated control-flow and dynamic-element helpers receive collision-safe
   imports, so the projection can be checked directly under the host project's
   Solid JSX configuration.
   It also returns exact equal-text authored/generated ranges. The
   `@tsrx/solid` adapter attaches Volar capabilities to those fail-closed
   ranges and retains its parser AST for document symbols; older compiler
   releases and incomplete documents continue through the legacy projection
   until native editor parity is complete.
3. `@tsrx/oxc` projects authored TSRX for Oxlint/Oxfmt and maps diagnostics and
   safe fixes back to authored ranges.

`@tsrx/solid`'s virtual projection must model the source-level callback
contract, not expose Solid's internal callback accessors: accessor-backed
`@for` item/index and `@catch` error reads are implicit in authored TSRX.
Compiler, Volar, and runtime fixtures cover the same callback-mode matrix.

The recommended general lint/format path is `@tsrx/oxc`.
`@tsrx/eslint-parser` and `@tsrx/eslint-plugin` remain useful for TSRX-specific
rules, but generic ESLint token-, scope-, and type-aware rules are not yet
complete enough to be the primary checker.

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
| `@for (const x of expr; index i)`                     | `<For each={expr} keyed={false}>{(x, i) => …}</For>`                                                               | yes — accessor item, raw numeric index                 |
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
- **RC `For` accessor semantics (adaptation).** With a custom `keyed` function
  the children callback receives accessor item and index parameters. An index
  without a key selects `keyed={false}`, whose callback receives an accessor
  item and raw numeric index; without either clause, the default callback item
  is raw. The desugarer rewrites only accessor-backed bindings to calls,
  scope-aware. Destructured accessor items become synthetic lazy parameters,
  so nested/defaulted/computed/rest reads remain deferred when a row is
  replaced.
- **RC `@catch` accessor semantics (adaptation).** Identifier error bindings
  rewrite to accessor calls. Object and array patterns become synthetic lazy
  parameters backed by the `ErrorAccessor`, preserving defaults, computed
  keys, rest views, and the current error value without eager destructuring.
- **Dynamic tags lower to the `Dynamic` builtIn** (`<Dynamic component={expr}
…>`), not `@tsrx/solid`'s hoisted `dynamic()` factory — semantically
  equivalent (web's `Dynamic` wraps `dynamic()`), uniform with the other
  builtIn lowerings, and simpler to mirror byte-for-byte in Rust.

### Stage 3 architecture and direct-AST migration

The plan's "walk `TsrxParseResult` → build `oxc_ast`" assumed a reusable
tape→AST bridge. There is none: the `FlatTape` is a generic JSON record store
of the _entire_ ESTree program, and `oxc_adapter` only serializes the other
direction (`oxc_ast` → tape, for NAPI transfer). Building `oxc_ast` from the
tape would mean a full-language ESTree deserializer against oxc 0.144 with a
per-upgrade sync burden.

Current architecture — **compiler-owned semantic IR with direct runtime AST
lowering**:

1. `tsrx_parser_engine::parse_tsrx` (pinned rev) parses and validates the
   TSRX source — the only TSRX grammar authority on the Rust side; its
   diagnostics surface as-is; unsupported syntax fails closed.
2. `semantic.rs` lowers the parser-interchange `FlatTape` into
   `SolidTsrxModule`: typed code blocks, if chains, for loops (including
   computed callback mode), switches, and try/pending/catch clauses with
   authored UTF-8 spans. It structurally validates required fields and records
   typed dynamic, lazy, lazy-assignment, style, raw-script, and shorthand sites.
   Lazy ids and accessor-backed pattern intent are assigned here rather than
   rediscovered by a backend.
   Ordinary JavaScript expressions and blocks remain read-only tape nodes;
   `FlatTape` itself is not the compiler IR.
3. `leaf.rs` asks `tsrx_syntax` for a legal parser scaffold and parses it once
   with crates.io oxc 0.144. The scaffold is only a carrier for authored
   JavaScript, TypeScript, and JSX leaves; it is not a Solid-JSX desugaring and
   is never reparsed.
4. `lower.rs` consumes `SolidTsrxModule`, clones authored leaves with rebased
   UTF-8 spans, and constructs code blocks, controls, dynamic elements,
   shorthand attributes, raw scripts, and scoped-style edits directly with
   `AstBuilder`. Every parser scaffold must be consumed before the program can
   enter the shared compiler.
5. Lazy `&` bindings and accessor callbacks feed compiler-owned rewrite
   artifacts into the existing symbol-aware AST pass (pattern → deterministic
   `__lazyN`, reads → deferred property/index access). No generated Solid-JSX
   text is parsed.
6. Native source maps use authored spans on cloned leaves. Generated-only
   nodes are unspanned, so mappings cannot bleed across compiler-created
   structure.
7. `project.rs` remains an explicit tooling projector. `tooling.rs` uses it to
   print independently type-checkable TSX and compose mappings back to authored
   `.tsrx`; runtime compilation no longer calls `project.rs`,
   `parse_projected_tsx`, or projection-map composition. CSS/raw-script embeds
   come from typed parser sites. Rust ranges remain authored UTF-8 bytes; the
   N-API adapter converts them to JavaScript UTF-16 string offsets.

`SolidTsrxModule` is internal compiler architecture, not a stable exported
`Node` API. This stage deliberately avoids both a second JavaScript semantic
implementation and a runtime dependency on `@tsrx/core` or `@tsrx/solid`.

Migration slices must remain subtractive: when semantic lowering owns a tape
shape or target decision, projection must consume that typed result and delete
its duplicate field discovery in the same change. Parser-shape helpers shared
by semantic, style, and projection passes live in `tape.rs`; transitional
fields need a named future backend consumer rather than an open-ended
compatibility shim. Every slice records its net code growth, preserves the
full byte-parity corpus, and is cleaned up before the next backend is added.
The migration is complete for runtime compilation: `project.rs` and
`style_projection.rs` now consume semantic template/lazy indices, and the
duplicate lazy preallocation, export validation, dynamic-tag, style-tag, and
shorthand discovery paths have been removed. Template blocks are partitioned
and escape-validated once in the IR, which also owns their post-lowering
render shape; the corresponding projector analysis and validation code has
been deleted. Runtime constructs now lower directly to Oxc AST and the
projected-TSX compiler reparse bridge has been deleted. The projector and its
parser remain intentionally scoped to the public type-checking/tooling path.

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
3. Babel desugars on its ESTree path. The Rust frontend lowers FlatTape into
   `SolidTsrxModule`, loads authored standard-language leaves once, and lowers
   TSRX constructs directly into `oxc_ast::Program`.
4. Existing shared lowering (`shared/` + `dom`/`ssr`/`universal`) runs
   unchanged; builtIns handling picks up `Show`/`For`/`Switch`/`Match`/
   `Errored`/`Loading` as usual.
