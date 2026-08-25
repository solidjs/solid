# @solidjs/compiler

Experimental AST-native JSX to DOM Expressions compiler implemented with Oxc.

## Installation

```bash
npm install @solidjs/compiler
```

The package ships prebuilt native binaries as per-platform packages
(`@solidjs/compiler-darwin-arm64`, `-darwin-x64`, `-linux-x64-gnu`,
`-linux-arm64-gnu`, `-win32-x64-msvc`). Your package manager installs the one
matching your platform automatically through `optionalDependencies`. On other
platforms, build from source with `pnpm run build` inside
`packages/compiler` (requires a Rust toolchain).

### WebAssembly and StackBlitz

The compiler also ships a WASI fallback for environments such as StackBlitz
WebContainers, where Node.js reports a native platform but cannot load `.node`
addons. Package managers install the WASI binding as an optional dependency
without requiring architecture configuration. The normal package entry point
prefers a native binding and falls back to
`@solidjs/compiler-wasm32-wasi` when native addons are unavailable.
Set `NAPI_RS_FORCE_WASI=error` to require the WASI binding for testing.

## Usage

This package exposes a compiler backend API. It is not a Vite, Rollup, or Babel
plugin by itself; integrations should call `transform()` once per source module.

```js
const { transform } = require("@solidjs/compiler");

const result = transform(`const view = <div>Hello</div>;`, {
  filename: "App.jsx",
  moduleName: "dom",
  generate: "dom"
});

console.log(result.code);
```

## Rust compiler core

The crate also exposes a host-independent Rust API:

```rust
use dom_expressions_compiler::{compile, CompileOptions};

let output = compile(
    "const view = <div>{name()}</div>;",
    &CompileOptions::default(),
)?;
```

Build with `--no-default-features` when embedding the compiler without its
Node-API adapter. The existing Node `transform()` delegates to the same
compiler core and keeps its current interface.

> **Stability:** the Rust API is unstable while the compiler is pre-1.0. It
> carries no semver commitment — options, output, and error types may change
> shape in any release, so pin an exact revision when embedding it. The Node
> `transform()` interface remains the supported public contract.

`transformAsync()` is also available for integration points that expect a
promise-returning transform:

```js
const { transformAsync } = require("@solidjs/compiler");

const result = await transformAsync(source, {
  filename: "App.jsx",
  moduleName: "dom",
  generate: "dom"
});
```

### Solid-Style DOM

Solid's DOM compiler preset uses DOM output with custom-element context
capture enabled. This compiler defaults `contextToCustomElements` to `true` to
match that behavior.

```js
const result = transform(source, {
  filename: "App.jsx",
  moduleName: "dom",
  generate: "dom",
  hydratable: true,
  builtIns: ["For", "Show"]
});
```

Use `dev: true` with `hydratable: true` to emit dev hydration walk validation
helpers such as `getFirstChild` / `getNextSibling`.

### SSR

```js
const result = transform(source, {
  filename: "entry-server.jsx",
  moduleName: "dom/server",
  generate: "ssr",
  hydratable: true,
  builtIns: ["For", "Show"]
});
```

### Universal

```js
const result = transform(source, {
  filename: "scene.jsx",
  moduleName: "renderer",
  generate: "universal"
});
```

### Dynamic Renderers

Dynamic mode uses the universal renderer as the fallback and can route a
configured set of native tags to the DOM renderer.

```js
const result = transform(source, {
  filename: "hybrid.jsx",
  moduleName: "renderer",
  generate: "dynamic",
  renderers: [
    {
      name: "dom",
      moduleName: "dom",
      elements: ["div", "span", "button", "input"]
    }
  ]
});
```

### Source Maps

Pass `sourceMap: true` to receive a JSON source map string in `result.map`.

```js
const result = transform(source, {
  filename: "App.jsx",
  moduleName: "dom",
  sourceMap: true
});

console.log(result.map);
```

### Options

Supported options track the Babel plugin where currently implemented:

- `filename`
- `moduleName`
- `generate`: `"dom"`, `"ssr"`, `"universal"`, or `"dynamic"`
- `hydratable`
- `dev`
- `sourceMap`
- `contextToCustomElements`
- `delegateEvents`
- `delegatedEvents`
- `omitQuotes`
- `omitAttributeSpacing`
- `inlineStyles`
- `effectWrapper`: custom import name string, or `false` to disable
- `memoWrapper`: custom import name string, or `false` to disable
- `wrapConditionals`
- `staticMarker`
- `validate`
- `omitNestedClosingTags`
- `omitLastClosingTag`
- `builtIns`
- `requireImportSource`
- `renderers`

### Server Function Directives (experimental)

`transformDirectives(code, options)` is a second, independent pass that ports
the `"use server"` directive transform (the Babel implementation hoisted from
SolidStart into vite-plugin-solid). It applies to plain `.js`/`.ts` modules as
well as JSX/TSX and is groundwork for the compiler becoming multi-pass (JSX,
directives, refresh) over a single parse.

```js
const { transformDirectives } = require("@solidjs/compiler");

const result = transformDirectives(source, {
  filename: "/project/src/api.ts",
  root: "/project",
  mode: "server" // or "client"
});

result.valid; // false when no directive matched — keep the original module
result.code; // registerServerReference/createServerReference output
result.functions; // [{ id, name, exports }] for manifest building
```

Server mode registers extracted functions through `registerServerReference(id, fn)`;
client mode replaces them with `createServerReference(id)` proxies and strips
server-only code from the module. Function IDs use the frozen
`xxhash32(root-relative path)-<count>` format (name-suffixed with
`env: "development"`), interchangeable with the Babel implementation's
manifests. The runtime module defaults to `@solidjs/web/server-functions` and
is configurable through the `register`/`create` options.

Ported so far (checked by the directives parity and snapshot suites):
module-level `"use server"` with exported functions in both modes,
function-level directives on function expressions/arrows (function
declarations are bubbled to `const` form first), client dead-code
elimination, and metadata reporting. Not yet ported: server functions nested
inside other extracted server functions, object/class method directives, and
sourcemap fidelity through the client DCE pass.

## Performance

Compared against `@solidjs/babel-plugin-jsx` compiling identical
sources under identical options (Apple M5, 10 cores, 32 GB RAM, Node 26,
release build, in-process, median of 7 iterations after warmup — run
`pnpm bench` in this package to reproduce on your machine):

| Workload                                        | babel-plugin-jsx | compiler | Speedup |
| ----------------------------------------------- | ---------------: | -----------: | ------: |
| Fixture corpus (88 files, 175 KB, all 10 modes) |           440 ms |        19 ms |     23x |
| 129 KB single module                            |           545 ms |       9.4 ms |     58x |
| 1 MB single module                              |        24,975 ms |        70 ms |    355x |

Native throughput stays roughly flat at ~9–14 MB/s as input grows, while
Babel's per-file cost grows super-linearly — so the gap widens with file size.

## Current Scope

This package is the AST-native compiler backend. It currently has checked fixture coverage for
the DOM, hydratable DOM, dev hydratable DOM, SSR, hydratable SSR, universal, dynamic, no-inline-styles, and wrapperless renderer paths.

- `generate: "dom"`
- `generate: "ssr"`
- `generate: "universal"`
- `generate: "dynamic"`
- native elements, components, fragments, refs, spreads, dynamic text, events, and
  attribute handling covered by the checked fixture suites for those targets
- Solid-compatible defaults such as `contextToCustomElements: true`
- option coverage for `hydratable`, `dev`, `delegateEvents`, `delegatedEvents`,
  `omitQuotes`, `omitAttributeSpacing`, `inlineStyles`, `effectWrapper`,
  `memoWrapper`, `wrapConditionals`, `requireImportSource`, `staticMarker`,
  `validate`, `omitNestedClosingTags`, `omitLastClosingTag`, `builtIns`, and
  dynamic `renderers`
- source maps for the implemented path

## Not Implemented Yet

The compiler intentionally rejects unsupported features instead of pretending to support them:

- DOM `namespaceElements` sections that the current Oxc parser rejects before transform
  (for example, hyphenated JSX member segments)
- arbitrary custom renderer names beyond dynamic DOM renderer override plus universal fallback
- unknown/custom namespaced DOM attributes outside known runtime namespaces such as `xlink`

## Architecture

The implementation is AST-native:

1. Parse with Oxc.
2. Transform JSX nodes with `VisitMut`.
3. Build replacement expressions and helper declarations with `AstBuilder`.
4. Codegen once with Oxc.

The module layout mirrors the Babel plugin shape where possible:

- `src/config.rs`
- `src/shared/ast.rs`
- `src/shared/transform.rs` for shared traversal and target dispatch
- `src/shared/component.rs`
- `src/shared/utils.rs`
- `src/dom/element.rs`
- `src/dom/template.rs`
- `src/ssr/mod.rs`
- `src/ssr/transform.rs`
- `src/universal/mod.rs`
- `src/universal/transform.rs`
