/** The object form of `sourceNames`: which kinds of source name to carry into output. */
export interface SourceNamesOptions {
  /** Component owner labels: the tag as written, as `createComponent`'s third argument. */
  components?: boolean;
  /** Binding effect labels: the element and attribute (or hole) each compiled effect writes. */
  bindings?: boolean;
}

export interface TransformOptions {
  filename?: string;
  /** Default `"@solidjs/web"`. */
  moduleName?: string;
  /**
   * Source syntax frontend, matching `@solidjs/babel-plugin`: `"auto"`
   * (default) routes `.tsrx` filenames through the TSRX frontend and
   * everything else through standard JSX; `"tsrx"` and `"jsx"` force a
   * frontend regardless of filename. TSRX support is experimental.
   */
  syntax?: "auto" | "jsx" | "tsrx";
  generate?: "dom" | "ssr" | "universal" | "dynamic";
  hydratable?: boolean;
  dev?: boolean;
  /**
   * Names as written in source, carried into output so the dev and observe
   * runtimes can label the reactive graph after minification.
   * `components`: the tag as a third `createComponent` argument
   * (`createComponent(Home, props, "Home")`) — DOM and SSR output (SSR
   * keeps the `createComponent` call it would otherwise inline to
   * `Comp(props)`); not universal or dynamic. `bindings`: every compiled
   * binding effect named by what it writes — `span.textContent`,
   * `div.class:active`, a hole `div.children`, a spread `div.spread` — as
   * an options argument on `effect`/`insert`/`spread`; DOM output only.
   * The production runtimes ignore the names. `true` enables every kind;
   * an object picks.
   */
  sourceNames?: boolean | SourceNamesOptions;
  sourceMap?: boolean;
  contextToCustomElements?: boolean;
  delegateEvents?: boolean;
  delegatedEvents?: string[];
  omitQuotes?: boolean;
  omitAttributeSpacing?: boolean;
  inlineStyles?: boolean;
  effectWrapper?: "effect" | false;
  wrapConditionals?: boolean;
  memoWrapper?: "memo" | false;
  staticMarker?: string;
  validate?: boolean;
  omitNestedClosingTags?: boolean;
  omitLastClosingTag?: boolean;
  serverComponents?: boolean;
  /** SSR-only, default `true`: component props literals with getters compile to module-level constructors with shared getters (#3511). */
  hoistProps?: boolean;
  /** Default `["For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored"]`. */
  builtIns?: string[];
  requireImportSource?: false | string;
  renderers?: RendererOption[];
}

export interface RendererOption {
  name: string;
  moduleName?: string;
  elements: string[];
}

export interface TransformResult {
  code: string;
  map?: string | null;
  /** Extracted scoped CSS for TSRX sources. */
  css?: string | null;
  /** Space-separated TSRX scope hashes. */
  cssHash?: string | null;
}

export function transform(code: string, options?: TransformOptions | null): TransformResult;
export function transformAsync(
  code: string,
  options?: TransformOptions | null
): Promise<TransformResult>;

export interface ProjectTsrxForTypecheckOptions {
  filename?: string;
}

export interface TsrxTypecheckEmbeddedRegion {
  kind: "css" | "script";
  /** Authored JavaScript string offset in UTF-16 code units. */
  start: number;
  /** Authored JavaScript string offset in UTF-16 code units. */
  end: number;
  content: string;
}

export interface TsrxTypecheckMapping {
  /** Authored JavaScript string offset in UTF-16 code units. */
  sourceStart: number;
  /** Generated JavaScript string offset in UTF-16 code units. */
  generatedStart: number;
  sourceLength: number;
  generatedLength: number;
}

export interface TsrxTypecheckProjectionResult {
  /** Valid post-semantic-rewrite TypeScript/TSX. */
  code: string;
  /** JSON source map from virtual TSX back to the authored `.tsrx` source. */
  map: string;
  /** Exact equal-text ranges suitable for editor feature mappings. */
  mappings: TsrxTypecheckMapping[];
  css: string;
  cssHash: string | null;
  embeddedRegions: TsrxTypecheckEmbeddedRegion[];
}

/**
 * Experimental compiler-owned TSRX projection for typechecking and editor
 * tooling. This API is host-independent and does not run a runtime renderer.
 */
export function projectTsrxForTypecheck(
  code: string,
  options?: ProjectTsrxForTypecheckOptions | null
): TsrxTypecheckProjectionResult;

export interface DirectiveImportDefinition {
  kind?: "named" | "default";
  name?: string;
  source: string;
}

/**
 * Options for the experimental `"use server"` directive pass. Applies to
 * plain `.js`/`.ts` modules as well as JSX/TSX.
 */
export interface TransformDirectivesOptions {
  /** Required — function IDs hash the root-relative file path. */
  filename: string;
  /** Project root for ID hashing. Defaults to the working directory. */
  root?: string;
  /**
   * `"server"` keeps the module and registers extracted functions;
   * `"client"` replaces them with reference proxies and strips server-only
   * code.
   */
  mode: "server" | "client";
  /** `"development"` appends function names to generated IDs. */
  env?: "production" | "development";
  /** @default "use server" */
  directive?: string;
  sourceMap?: boolean;
  /** Runtime import for `registerServerReference` (server output). */
  register?: DirectiveImportDefinition;
  /** Runtime import for `createServerReference` (both outputs). */
  create?: DirectiveImportDefinition;
}

/** One extracted server function, for building a bundler manifest. */
export interface ServerFunctionMeta {
  /** The wire ID (`<name>-<hash>[-<ordinal>]`). */
  id: string;
  /**
   * The dotted binding path that names the function, such as
   * `handlers.save`. `anonymous` when no enclosing binding applies.
   */
  name: string;
  /** Export names bound to this function (module-level directives only). */
  exports: string[];
}

export interface TransformDirectivesResult {
  code: string;
  map?: string | null;
  /** False when the module contained no matching directive. */
  valid: boolean;
  functions: ServerFunctionMeta[];
}

export function transformDirectives(
  code: string,
  options: TransformDirectivesOptions
): TransformDirectivesResult;
export function transformDirectivesAsync(
  code: string,
  options: TransformDirectivesOptions
): Promise<TransformDirectivesResult>;

/**
 * Options for the experimental `lazy()` module-URL pass (ported from
 * vite-plugin-solid's `lazy-module-url` Babel plugin).
 */
export interface TransformLazyOptions {
  /**
   * Mirrors the Babel plugin: without a filename the pass is a no-op (the
   * emitted placeholder is only useful to a bundler resolving relative to a
   * module id).
   */
  filename?: string;
  sourceMap?: boolean;
}

export function transformLazy(code: string, options?: TransformLazyOptions | null): TransformResult;
export function transformLazyAsync(
  code: string,
  options?: TransformLazyOptions | null
): Promise<TransformResult>;

/**
 * Options for the experimental solid-refresh HMR pass (ported from the
 * `solid-refresh` Babel plugin, `jsx: false` mode). Dev-only.
 */
export interface TransformRefreshOptions {
  /**
   * Used for `location` metadata (cwd-relative, matching the Babel plugin)
   * and to pick the parser dialect. Without it no locations are emitted.
   */
  filename?: string;
  /**
   * Selects the HMR API: `import.meta.hot` (esm/vite),
   * `import.meta.webpackHot` (webpack5/rspack-esm) or `module.hot`
   * (standard).
   * @default "standard"
   */
  bundler?: "esm" | "vite" | "webpack5" | "rspack-esm" | "standard";
  /**
   * Wrap top-level `render()`/`hydrate()` calls (imported from
   * `@solidjs/web`) with `hot.dispose` cleanup.
   * @default true
   */
  fixRender?: boolean;
  /**
   * Emit per-component `signature`/`dependencies` metadata for granular HMR.
   * @default true
   */
  granular?: boolean;
  /**
   * The Babel plugin's JSX-granularity mode is not ported; only `false` is
   * accepted (what vite-plugin-solid passes).
   */
  jsx?: false;
  /**
   * Module the runtime helpers (`$$registry`, `$$component`, `$$refresh`,
   * `$$decline`) are imported from. The dev-only `solid-js/refresh` entry
   * exposes the same frozen ABI.
   * @default "solid-refresh"
   */
  importSource?: string;
  sourceMap?: boolean;
}

export function transformRefresh(
  code: string,
  options?: TransformRefreshOptions | null
): TransformResult;
export function transformRefreshAsync(
  code: string,
  options?: TransformRefreshOptions | null
): Promise<TransformResult>;

/**
 * Options for the `sourceNames.primitives` pass: reactive primitives named
 * after the identifier they are declared as. `const [count, setCount] =
 * createSignal(0)` becomes `createSignal(0, { name: "count" })`; inside a
 * non-component function the name is prefixed with that function's
 * (`createCounter.count`). Only calls resolving to imports from `solid-js` /
 * `@solidjs/signals` are named, and an explicit `name` is never overridden.
 * Plain JavaScript in and out, so it applies to `.ts`/`.js` modules too;
 * `@solidjs/vite-plugin` runs it ahead of the JSX transform.
 */
export interface TransformSourceNamesOptions {
  /** Picks the parser dialect (`.ts`, `.tsx`, `.js`, `.jsx`); TSX without one. */
  filename?: string;
  sourceMap?: boolean;
}

export function transformSourceNames(
  code: string,
  options?: TransformSourceNamesOptions | null
): TransformResult;
export function transformSourceNamesAsync(
  code: string,
  options?: TransformSourceNamesOptions | null
): Promise<TransformResult>;
