export type RendererName = "dom" | "ssr" | "universal" | string;

export interface RendererConfig {
  name: RendererName;
  moduleName?: string;
  elements: string[];
}

/**
 * What `sourceNames` carries from source into output, per kind. `true` for
 * the option means every kind.
 */
export interface SourceNamesConfig {
  /** Component owner labels: the tag as written, as `createComponent`'s third argument. */
  components?: boolean;
  /** Binding effect labels: the element and attribute (or hole) each compiled effect writes. */
  bindings?: boolean;
}

export interface PluginConfig {
  moduleName: string;
  /** Source syntax frontend: "auto" routes `.tsrx` files through the TSRX
   * parser and everything else through standard JSX; "tsrx" forces TSRX for
   * every file; "jsx" disables TSRX routing entirely. TSRX support is
   * experimental and requires the optional `@tsrx/core` peer dependency. */
  syntax: "auto" | "jsx" | "tsrx";
  generate: "dom" | "ssr" | "universal" | "dynamic";
  hydratable: boolean;
  dev: boolean;
  /** Names as written in source, carried into output so the dev and
   * observe runtimes can label the reactive graph after minification.
   * `components`: the tag as a third `createComponent` argument
   * (`createComponent(Home, props, "Home")`) — DOM and SSR output (SSR
   * keeps the `createComponent` call it would otherwise inline to
   * `Comp(props)`); not universal or dynamic. `bindings`: every compiled
   * binding effect named by what it writes — `span.textContent`,
   * `div.class:active`, `div.style:color`, a hole `div.children`, a spread
   * `div.spread` — as an options argument on `effect`/`insert`/`spread`;
   * DOM output only. The production runtimes ignore the names. `true`
   * enables every kind; an object picks. */
  sourceNames: boolean | SourceNamesConfig;
  delegateEvents: boolean;
  delegatedEvents: string[];
  builtIns: string[];
  requireImportSource: false | string;
  wrapConditionals: boolean;
  omitNestedClosingTags: boolean;
  omitLastClosingTag: boolean;
  omitQuotes: boolean;
  omitAttributeSpacing: boolean;
  contextToCustomElements: boolean;
  staticMarker: string;
  effectWrapper: string | false;
  memoWrapper: string | false;
  validate: boolean;
  inlineStyles: boolean;
  serverComponents: boolean;
  /** SSR only: emit each component's props literal with getters as a
   * module-level constructor with shared getters (one hidden class per call
   * site, no closure per getter per instance) instead of an object literal,
   * which V8 builds in dictionary mode. Same own keys, order, descriptors
   * and prototype; a getter is defined only for a read through its own
   * object (#3511). `false` keeps the literal everywhere. */
  hoistProps: boolean;
  renderers?: RendererConfig[];
}

const config: PluginConfig = {
  moduleName: "@solidjs/web",
  syntax: "auto",
  generate: "dom",
  hydratable: false,
  dev: false,
  sourceNames: false,
  delegateEvents: true,
  delegatedEvents: [],
  builtIns: [
    "For",
    "Show",
    "Switch",
    "Match",
    "Loading",
    "Reveal",
    "Portal",
    "Repeat",
    "Dynamic",
    "Errored"
  ],
  requireImportSource: false,
  wrapConditionals: true,
  omitNestedClosingTags: false,
  omitLastClosingTag: true,
  omitQuotes: true,
  omitAttributeSpacing: true,
  contextToCustomElements: true,
  staticMarker: "@static",
  effectWrapper: "effect",
  memoWrapper: "memo",
  validate: true,
  inlineStyles: true,
  serverComponents: false,
  hoistProps: true
};

/** `sourceNames` resolved to its per-kind flags (`true` → every kind on). */
export function sourceNames(config: PluginConfig): Required<SourceNamesConfig> {
  const value = config.sourceNames;
  if (typeof value === "boolean") return { components: value, bindings: value };
  return { components: value?.components ?? false, bindings: value?.bindings ?? false };
}

/**
 * Whether this generate names its compiled binding effects: `sourceNames.bindings`
 * on plain DOM output. The dynamic generate's DOM subtrees and universal
 * renderers own their `effect`/`insert`/`spread` signatures, so they never
 * carry the options argument.
 */
export function namesBindings(config: PluginConfig): boolean {
  return config.generate === "dom" && sourceNames(config).bindings;
}

export default config;
