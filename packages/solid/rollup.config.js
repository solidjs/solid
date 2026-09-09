import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: [".js", ".ts"],
    exclude: "node_modules/**",
    babelrc: false,
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"]
  }),
  cleanup({
    comments: ["some", /PURE/],
    extensions: [".js", ".ts"]
  })
];

// Three tiers, two literals (mirrors @solidjs/signals' __DEV__/__OBSERVE__):
//   dev      IS_DEV true   IS_OBSERVE true   — checks + wiring   (*.dev.*)
//   observe  IS_DEV false  IS_OBSERVE true   — wiring only       (*.observe.*)
//   prod     IS_DEV false  IS_OBSERVE false  — neither           (default)
// Dev implies observe. Both literals must be replaced in EVERY build: without
// it babel constant-folds the truthy string literal and the first gate anyone
// adds takes the dev branch in production (the #2982 failure @solidjs/web's
// server entry shipped with).
const replaceFlags = (isDev, isObserve) =>
  replace({
    '"_SOLID_DEV_"': isDev,
    '"_SOLID_OBSERVE_"': isObserve,
    preventAssignment: true,
    delimiters: ["", ""]
  });

const build = (input, name, external, isDev, isObserve) => ({
  input,
  output: [
    { file: `dist/${name}.cjs`, format: "cjs" },
    { file: `dist/${name}.js`, format: "es" }
  ],
  external,
  plugins: [replaceFlags(isDev, isObserve)].concat(plugins)
});

const client = ["@solidjs/signals"];
const server = ["@solidjs/signals", "stream"];
// The refresh runtime imports the main entry ("solid-js") rather than
// relative sources so it shares module state ($DEVCOMP, DEV) with the
// solid-js instance the app resolves at build time.
const refresh = ["solid-js", "@solidjs/signals"];

export default [
  build("src/index.ts", "solid", client, false, false),
  // Observe client build: component roots carry their `_name` label and flow
  // controls name their memos, so `ownerPath` and attribution see the
  // component tree; every dev-only check folds out. Selected by the `observe`
  // condition nested under `browser`.
  build("src/index.ts", "solid.observe", client, false, true),
  build("src/index.ts", "solid.dev", client, true, true),
  // Server builds. `src/server/` has no wiring sites yet, so server.observe.*
  // differs from server.* only in exporting a live OBSERVE — it exists so
  // `import { OBSERVE } from "solid-js"` agrees with `@solidjs/signals` when
  // both resolve under the `observe` condition in one process. The first
  // server emit site (server-dev-build-plan P1) gives it real content.
  build("src/server/index.ts", "server", server, false, false),
  build("src/server/index.ts", "server.observe", server, false, true),
  // Dev server build, selected by the `development` condition nested under
  // `node`/`worker`/`deno` in package.json exports (nested on purpose: at the
  // top level `node` precedes `development` and would win). Until this
  // existed, SSR had no dev build at all — server-side dev diagnostics had
  // nowhere to run. Mirrors `@solidjs/web/server-functions`'s server.dev.
  build("src/server/index.ts", "server.dev", server, true, true),
  build("src/refresh/index.ts", "refresh", refresh, false, false),
  build("src/refresh/index.ts", "refresh.dev", refresh, true, true),
  // `solid-js/attribution`: a re-export of `@solidjs/signals/attribution`
  // with no wiring of its own, so one build serves every tier — the engine it
  // resolves to is chosen where the signals subpath is resolved.
  build("src/attribution.ts", "attribution", ["@solidjs/signals/attribution"], false, false)
];
