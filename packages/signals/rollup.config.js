import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import prettier from "rollup-plugin-prettier";

// Three tiers, two flags (see src/globals.d.ts):
//   dev      __DEV__ true   __OBSERVE__ true   — checks + wiring
//   observe  __DEV__ false  __OBSERVE__ true   — wiring only (prod-legal)
//   prod     __DEV__ false  __OBSERVE__ false  — neither; byte-identical to
//                                                 the pre-observe prod build
// `__DEV__` implies `__OBSERVE__`; dev.ts asserts it at module init.
//
// Only the prod and observe ESM builds are per-module trees
// (`preserveModules`); they are consumed exclusively by bundlers, which can
// drop whole feature modules — including their top-level GlobalQueue hook
// installs, which statement-level shaking of a flat file can never remove
// (#2883) — and scope-hoist the rest back into one module. Dev and node
// (prod, observe and dev CJS) stay flat single files: dev bundle size doesn't
// matter (and vitest's per-module SSR transform makes a chunked tree ~2x
// slower in the flush hot path, poisoning CI benches), and CJS `require`
// can't tree-shake, so a tree would charge unbundled SSR the per-module-
// boundary cost (~10% native ESM) for nothing.
//
// `_`-prefixed property mangling for prod and observe outputs runs as a
// single sequential post-pass (scripts/mangle-props.mjs) with one shared
// nameCache per output; per-chunk terser would mangle the same property to
// different names in different modules and break every cross-module member
// access. `_name` is reserved (the cross-package label field).
//
// Two entries per build: `index` (the core) and `attribution` (the engine
// behind `@solidjs/signals/attribution`). The engine reads the core's live
// state, so both MUST share one module instance per tier — never two flat
// bundles that each carry their own copy of core. The trees get that for
// free (preserveModules); the flat builds are code-split instead: the two
// entries plus one shared chunk (`<name>-shared.<ext>`), all mangled as one
// consistency domain. Prod's engine entry is `attribution.prod.ts`, an inert
// twin with the same surface — a prod build has no hook sites to feed one.

const flags = (dev, observe) =>
  replace({
    __DEV__: String(dev),
    __OBSERVE__: String(observe),
    __TEST__: "false",
    preventAssignment: true
  });

const ts = outDir =>
  typescript({
    declaration: false,
    outDir,
    module: "esnext",
    target: "esnext",
    moduleResolution: "bundler",
    verbatimModuleSyntax: true
  });

const pretty = prettier({ parser: "typescript" });

// NO prettier on the per-module trees: rollup-plugin-prettier strips
// /*@__PURE__*/ annotations, silently disabling consumer-side DCE of
// annotated initializers. The mangle-props post-pass beautifies that output
// anyway (and must run terser with preserve_annotations).
const engine = observe => (observe ? "src/attribution.ts" : "src/attribution.prod.ts");

const tree = (dir, dev, observe) => ({
  input: { index: "src/index.ts", attribution: engine(observe) },
  output: { dir, format: "esm", preserveModules: true, preserveModulesRoot: "src" },
  plugins: [flags(dev, observe), ts(dir)]
});

// `name` is the stem: dist/<name>.<ext> (core), dist/<name>.attribution.<ext>
// (engine), dist/<name>-shared.<ext> (the one chunk both import). Prod has no
// chunk: its inert engine imports nothing from core.
const flat = (name, format, dev, observe) => {
  const ext = format === "cjs" ? "cjs" : "js";
  return {
    input: { [name]: "src/index.ts", [`${name}.attribution`]: engine(observe) },
    output: {
      dir: "dist",
      format,
      exports: "named",
      entryFileNames: `[name].${ext}`,
      chunkFileNames: `${name}-shared.${ext}`
    },
    plugins: [flags(dev, observe), ts("dist"), pretty]
  };
};

export default [
  flat("dev", "esm", true, true),
  tree("dist/prod", false, false),
  // Observe tier: the ~40 wiring sites survive (attribution hooks, `_name`,
  // edge counters, the diagnostics channel), every check folds out. Selected
  // by the `observe` export condition. Gets its own size-limit scenario; the
  // prod tree's caps must not move because of it.
  tree("dist/observe", false, true),
  flat("node", "cjs", false, false),
  // Dev CJS — the `require` twin of dist/dev.js, selected by the `development`
  // condition on the `require` branch. Without it a CJS host that resolved
  // solid-js's `dist/server.dev.cjs` would `require` the prod `dist/node.cjs`
  // and get `DEV === undefined` from a dev artifact — a lie that goes
  // unnoticed until something emits into the diagnostics channel. Not mangled
  // (dev outputs never are — see build:js).
  flat("node.dev", "cjs", true, true),
  flat("node.observe", "cjs", false, true)
];
