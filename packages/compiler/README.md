# @solidjs/compiler

Solid 2.0's native Oxc JSX compiler. Integrations call `transform()` once per source module; this package is not a Vite, Rollup, or Babel plugin by itself. The JavaScript fallback is [`@solidjs/babel-plugin`](../babel-plugin).

> **Solid 2.0 (Release Candidate).** Pin exact versions. The Node `transform()` interface is the supported public contract; the Rust `compile` API is unstable.

## Installation

```bash
npm install @solidjs/compiler
```

The package ships prebuilt native binaries as optional per-platform packages (`@solidjs/compiler-darwin-arm64`, `-darwin-x64`, `-linux-x64-gnu`, `-linux-arm64-gnu`, `-win32-x64-msvc`). Your package manager installs the one matching your platform. On other platforms, build from source with `pnpm run build` inside `packages/compiler` (requires a Rust toolchain).

### WebAssembly and StackBlitz

A WASI fallback covers environments such as StackBlitz WebContainers, where Node reports a native platform but cannot load `.node` addons. Package managers install `@solidjs/compiler-wasm32-wasi` as an optional dependency. The package entry prefers a native binding and falls back to WASI when native addons are unavailable.

- `NAPI_RS_FORCE_WASI=error` requires the WASI binding (useful in tests).
- `SOLID_COMPILER_NATIVE=/path/to/binding.node` loads an explicit native addon.

## Usage

Omitted options match `@solidjs/babel-plugin` (and the old `babel-preset-solid`): `moduleName` is `"@solidjs/web"`, `generate` is `"dom"`, and control-flow tags (`For`, `Show`, `Switch`, `Match`, `Loading`, `Reveal`, `Portal`, `Repeat`, `Dynamic`, `Errored`) are auto-imported from that module.

```js
const { transform } = require("@solidjs/compiler");

const result = transform(`const view = <div>Hello</div>;`, {
  filename: "App.jsx"
});

console.log(result.code);
```

`transformAsync()` is the same transform behind a promise, for integration points that expect one.

### Client DOM

```js
const result = transform(source, {
  filename: "App.jsx",
  generate: "dom",
  hydratable: true
});
```

`contextToCustomElements` defaults to `true`. Use `dev: true` with `hydratable: true` to emit hydration walk helpers such as `getFirstChild` / `getNextSibling`.

### SSR

SSR still imports runtime helpers from `@solidjs/web`. Set `generate: "ssr"` (and `hydratable: true` when the client will hydrate).

```js
const result = transform(source, {
  filename: "entry-server.jsx",
  generate: "ssr",
  hydratable: true
});
```

### Universal and dynamic

Custom renderers use `generate: "universal"` with `moduleName` pointing at the renderer package. Dynamic mode uses that renderer as the fallback and can route a configured set of native tags to the DOM renderer.

```js
const result = transform(source, {
  filename: "hybrid.jsx",
  moduleName: "solid-custom-dom",
  generate: "dynamic",
  renderers: [
    {
      name: "dom",
      moduleName: "@solidjs/web",
      elements: ["div", "span", "button", "input"]
    }
  ]
});
```

### TSRX (experimental)

TSRX (TypeScript Render Extensions) is a syntax for declarative UI whose constructs (`@if`/`@else`, `@for … @empty`, `@switch`/`@case`, `@try`/`@catch`/`@pending`, `@{}` statement containers, lazy destructuring `&{ }` / `&[ ]`) desugar to the Solid control-flow components. `.tsrx` filenames route through the TSRX frontend automatically and compile to the same output as `@solidjs/babel-plugin`'s TSRX support, byte for byte.

```js
const result = transform(tsrxSource, { filename: "App.tsrx" });
// TSRX <style> blocks are extracted alongside the JavaScript:
result.css;
result.cssHash;
```

Routing follows the filename by default (`syntax: "auto"`); pass `syntax: "tsrx"` or `syntax: "jsx"` to force a frontend regardless of filename. No extra install is needed — the shipped binaries include the frontend (Rust embedders can disable the default `tsrx` cargo feature).

Scoped `<style>` blocks are compile-time only. The compiler removes the style element, adds its `tsrx-<hash>` class to matching native and dynamic elements, scopes and prunes the CSS, and returns the stylesheet in `css` with its scope identifier in `cssHash`. Style expressions produce class-map objects, `<style ref={styles}>` initializes the requested class map, and `:global(...)` opts individual selectors out of scoping. A bundler integration must emit the returned CSS; the core compiler does not inject a runtime style helper.

Lazy patterns support synchronous and asynchronous arrow parameters, nested, renamed, and computed bindings, JavaScript-style defaults, object/array rest, and standalone `&{ … } = value;` / `&[ … ] = value;` statements. Defaults apply only when the deferred value is `undefined`; rest bindings are fresh read-only views. Matching the JavaScript TSRX parser, defaults are not yet accepted in standalone assignment patterns.

Destructured bindings in keyed `@for` loops and `@catch` clauses stay deferred against Solid's item and error accessors, including nested patterns, defaults, computed keys, and rest.

The frontend uses the community [oxc-tsrx](https://github.com/tsrx-org/oxc) parser at a pinned revision. Statement containers can be used as function bodies, statements, expressions (`const x = @{ … }`), and JSX children or expression containers. See `documentation/tsrx/frontend-notes.md` in the repository for the full frontend notes.

`projectTsrxForTypecheck(source, { filename })` is an experimental compiler-owned projection for editor and typecheck integrations. It returns independently typecheckable post-rewrite TSX without running the DOM/SSR/universal transforms, injecting collision-safe imports for generated Solid control-flow and dynamic-element helpers. The result also includes an authored `.tsrx` source map, processed `css`/`cssHash`, and parser-authored embedded CSS/raw-script regions. Embedded offsets use JavaScript UTF-16 string coordinates. This is a generic compiler API, not a Volar mapping adapter.

### Source maps

Pass `sourceMap: true` to receive a JSON source map string in `result.map`. For TSRX, the compiler composes Oxc's generated-JavaScript map through the internal TSX text projection, returning the original `.tsrx` filename and source in `sources` and `sourcesContent`. Authored expressions and lazy/accessor rewrites map back to their TSRX locations; projection-only scaffolding remains explicitly unmapped rather than being attributed to nearby syntax.

### Options

- `filename`
- `moduleName` (default `"@solidjs/web"`)
- `syntax`: `"auto"`, `"jsx"`, or `"tsrx"` (default `"auto"` — routes `.tsrx` filenames through the TSRX frontend)
- `generate`: `"dom"`, `"ssr"`, `"universal"`, or `"dynamic"` (default `"dom"`)
- `hydratable`
- `dev`
- `sourceMap`
- `contextToCustomElements` (default `true`)
- `delegateEvents`
- `delegatedEvents`
- `omitQuotes`
- `omitAttributeSpacing`
- `inlineStyles`
- `effectWrapper`: import name string, or `false` to disable
- `memoWrapper`: import name string, or `false` to disable
- `wrapConditionals`
- `staticMarker`
- `validate`
- `omitNestedClosingTags`
- `omitLastClosingTag`
- `builtIns` (default `["For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored"]`)
- `requireImportSource`
- `serverComponents`
- `renderers`

### Server function directives (experimental)

`transformDirectives(code, options)` is a second pass for `"use server"`. It accepts ordinary JavaScript/TypeScript, including JSX/TSX. For a `.tsrx` module, run `transform()` first, then pass its generated code to `transformDirectives()` with the same original `.tsrx` filename so function IDs use the manifest path. `transformDirectives()` does not parse raw TSRX syntax itself.

```js
const { transformDirectives } = require("@solidjs/compiler");

const result = transformDirectives(source, {
  filename: "/project/src/api.ts",
  root: "/project",
  mode: "server" // or "client"
});

result.valid; // false when no directive matched — keep the original module
result.code;
result.functions; // [{ id, name, exports }] for manifest building
```

The runtime module defaults to `@solidjs/web/server-functions`. Function IDs use `xxhash32(root-relative path)-<count>` (name-suffixed with `env: "development"`). There are also experimental `transformLazy` and `transformRefresh` passes.

## Rust compiler core

The crate also exposes a host-independent Rust API. The crate name is `solidjs-compiler`; the Node `transform()` delegates to the same core.

```rust
use solidjs_compiler::{
    compile, project_tsrx_for_typecheck, CompileOptions,
    TsrxTypecheckProjectionOptions,
};

let output = compile(
    "const view = <div>{name()}</div>;",
    &CompileOptions::default(),
)?;

let tsrx_source = "export function View() @{ <div /> }";
let virtual_tsx =
    project_tsrx_for_typecheck(tsrx_source, &TsrxTypecheckProjectionOptions::default())?;
```

`CompileOptions::default()` uses `module_name: "@solidjs/web"` and the same control-flow `built_ins` as the Babel plugin. Build with `--no-default-features` when embedding without the Node-API adapter.

The unstable Rust typecheck projection reports embedded ranges in authored UTF-8 bytes. The N-API adapter converts those ranges to UTF-16 code units for JavaScript tooling.

> **Stability:** the Rust API is unstable while the compiler is pre-1.0. Options, output, and error types may change in any release — pin an exact revision when embedding it.

## Performance

Compared against `@solidjs/babel-plugin` compiling identical sources under identical options (Apple M5, 10 cores, 32 GB RAM, Node 26, release build, in-process, median of 7 iterations after warmup — run `pnpm bench` in this package to reproduce):

| Workload                                        | babel-plugin | compiler | Speedup |
| ----------------------------------------------- | -----------: | -------: | ------: |
| Fixture corpus (88 files, 175 KB, all 10 modes) |       440 ms |    19 ms |     23x |
| 129 KB single module                            |       545 ms |   9.4 ms |     58x |
| 1 MB single module                              |    24,975 ms |    70 ms |    355x |

Native throughput stays roughly flat as input grows, while Babel's per-file cost grows super-linearly.

## Architecture

Parse with Oxc, transform JSX with `VisitMut`, build replacements with `AstBuilder`, codegen once. Unsupported features are rejected rather than silently ignored. The module layout follows the Babel plugin (`shared`, `dom`, `ssr`, `universal`) where that mapping is useful.
