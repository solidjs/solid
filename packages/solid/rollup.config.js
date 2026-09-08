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

const replaceDev = isDev =>
  replace({
    '"_SOLID_DEV_"': isDev,
    preventAssignment: true,
    delimiters: ["", ""]
  });

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/solid.cjs",
        format: "cjs"
      },
      {
        file: "dist/solid.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    // Prod server build. `src/server/` has no `"_SOLID_DEV_"` gates today, but
    // the replace must run anyway: without it babel constant-folds the truthy
    // string literal and the first gate anyone adds takes the dev branch in
    // production (the #2982 failure @solidjs/web's server entry shipped with).
    input: "src/server/index.ts",
    output: [
      {
        file: "dist/server.cjs",
        format: "cjs"
      },
      {
        file: "dist/server.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals", "stream"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    // Dev server build, selected by the `development` condition nested under
    // `node`/`worker`/`deno` in package.json exports (nested on purpose: at the
    // top level `node` precedes `development` and would win). Until this
    // existed, SSR had no dev build at all — server-side dev diagnostics had
    // nowhere to run. Mirrors `@solidjs/web/server-functions`'s server.dev.
    input: "src/server/index.ts",
    output: [
      {
        file: "dist/server.dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/server.dev.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals", "stream"],
    plugins: [replaceDev(true)].concat(plugins)
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/solid.dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/solid.dev.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals"],
    plugins: [replaceDev(true)].concat(plugins)
  },
  // The refresh runtime imports the main entry ("solid-js") rather than
  // relative sources so it shares module state ($DEVCOMP, DEV) with the
  // solid-js instance the app resolves at build time.
  {
    input: "src/refresh/index.ts",
    output: [
      {
        file: "dist/refresh.cjs",
        format: "cjs"
      },
      {
        file: "dist/refresh.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/signals"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "src/refresh/index.ts",
    output: [
      {
        file: "dist/refresh.dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/refresh.dev.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/signals"],
    plugins: [replaceDev(true)].concat(plugins)
  }
];
