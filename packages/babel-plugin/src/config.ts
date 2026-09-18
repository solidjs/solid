export type RendererName = "dom" | "ssr" | "universal" | string;

export interface RendererConfig {
  name: RendererName;
  moduleName?: string;
  elements: string[];
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
  /** Emit the source tag name as a third `createComponent` argument
   * (`createComponent(Home, props, "Home")`) so dev/observe runtimes can
   * label owners after minification renames the function. DOM and SSR
   * output (SSR keeps the `createComponent` call it would otherwise inline
   * to `Comp(props)`); not universal or dynamic. The production runtimes
   * ignore the argument. */
  componentNames: boolean;
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
  componentNames: false,
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

export default config;
