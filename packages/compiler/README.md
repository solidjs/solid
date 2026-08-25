# @solidjs/compiler

Solid 2.0's native Oxc JSX compiler. Integrations call `transform()` once per source module; this package is not a Vite, Rollup, or Babel plugin by itself. The JavaScript fallback is [`@solidjs/babel-plugin-jsx`](../babel-plugin-jsx).

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

Omitted options match `@solidjs/babel-plugin-jsx` (and the old `babel-preset-solid`): `moduleName` is `"@solidjs/web"`, `generate` is `"dom"`, and control-flow tags (`For`, `Show`, `Switch`, `Match`, `Loading`, `Reveal`, `Portal`, `Repeat`, `Dynamic`, `Errored`) are auto-imported from that module.

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

### Source maps

Pass `sourceMap: true` to receive a JSON source map string in `result.map`.

### Options

- `filename`
- `moduleName` (default `"@solidjs/web"`)
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

`transformDirectives(code, options)` is a second pass for `"use server"`. It applies to plain `.js`/`.ts` as well as JSX/TSX.

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
use solidjs_compiler::{compile, CompileOptions};

let output = compile(
    "const view = <div>{name()}</div>;",
    &CompileOptions::default(),
)?;
```

`CompileOptions::default()` uses `module_name: "@solidjs/web"` and the same control-flow `built_ins` as the Babel plugin. Build with `--no-default-features` when embedding without the Node-API adapter.

> **Stability:** the Rust API is unstable while the compiler is pre-1.0. Options, output, and error types may change in any release — pin an exact revision when embedding it.

## Performance

Compared against `@solidjs/babel-plugin-jsx` compiling identical sources under identical options (Apple M5, 10 cores, 32 GB RAM, Node 26, release build, in-process, median of 7 iterations after warmup — run `pnpm bench` in this package to reproduce):

| Workload                                        | babel-plugin-jsx | compiler | Speedup |
| ----------------------------------------------- | ---------------: | -------: | ------: |
| Fixture corpus (88 files, 175 KB, all 10 modes) |           440 ms |    19 ms |     23x |
| 129 KB single module                            |           545 ms |   9.4 ms |     58x |
| 1 MB single module                              |        24,975 ms |    70 ms |    355x |

Native throughput stays roughly flat as input grows, while Babel's per-file cost grows super-linearly.

## Architecture

Parse with Oxc, transform JSX with `VisitMut`, build replacements with `AstBuilder`, codegen once. Unsupported features are rejected rather than silently ignored. The module layout follows the Babel plugin (`shared`, `dom`, `ssr`, `universal`) where that mapping is useful.
