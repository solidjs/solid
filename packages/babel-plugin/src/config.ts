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
  /** Graph-native REGION emission (DESIGN-REGIONS.md): template scopes
   * whose bindings are depth-1 member reads of one stable store subject
   * compile to one region effect (raw commit reads + tracked residuals)
   * with a classic fallback. Prototype — off by default. */
  regions: boolean;
  validate: boolean;
  inlineStyles: boolean;
  serverComponents: boolean;
  renderers?: RendererConfig[];
}

const config: PluginConfig = {
  moduleName: "@solidjs/web",
  syntax: "auto",
  generate: "dom",
  hydratable: false,
  dev: false,
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
  regions: false,
  validate: true,
  inlineStyles: true,
  serverComponents: false
};

export default config;
