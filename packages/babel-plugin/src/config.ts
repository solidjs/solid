export type RendererName = "dom" | "ssr" | "universal" | string;

export interface RendererConfig {
  name: RendererName;
  moduleName?: string;
  elements: string[];
}

export interface PluginConfig {
  moduleName: string;
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
  /** Patch-mode driver import name (DESIGN-PATCH-CHANNEL.md): when set,
   * template scopes whose dynamic bindings are pure member reads of one
   * subject compile to a compiled patch body + driver call instead of the
   * grouped effect. DORMANT (off) by default while the patch channel
   * completes on its stage-2 branch (extraction ruling, solid DESIGN §16):
   * compiled output must not import driver exports the release core only
   * stubs. Set to the driver's export name (e.g. "patchDriver") to opt a
   * build in against a channel-bearing core. */
  patchDriver: string | false;
  memoWrapper: string | false;
  validate: boolean;
  inlineStyles: boolean;
  serverComponents: boolean;
  renderers?: RendererConfig[];
}

const config: PluginConfig = {
  moduleName: "@solidjs/web",
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
  patchDriver: false,
  memoWrapper: "memo",
  validate: true,
  inlineStyles: true,
  serverComponents: false
};

export default config;
