import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";
import { fileURLToPath } from "node:url";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: [".js", ".ts"],
    exclude: "node_modules/**",
    babelrc: false,
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"],
    plugins: [
      [
        "babel-plugin-transform-rename-import",
        {
          original: "rxcore",
          replacement: fileURLToPath(new URL("src/core", import.meta.url))
        }
      ]
    ]
  }),
  cleanup({
    comments: ["some", /PURE/],
    extensions: [".js", ".ts"]
  })
];

const replaceDev = isDev =>
  replace({
    '"_SOLID_DEV_"': isDev,
    '"_DX_DEV_"': isDev,
    preventAssignment: true,
    delimiters: ["", ""]
  });

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/web.cjs",
        format: "cjs"
      },
      {
        file: "dist/web.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "server/index.ts",
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
    external: ["solid-js", "stream", "seroval", "seroval-plugins/web"],
    plugins
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/dev.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(true)].concat(plugins)
  },
  {
    input: "storage/src/index.ts",
    output: [
      {
        file: "storage/dist/storage.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "storage/dist/storage.js",
        format: "es"
      }
    ],
    external: ["@solidjs/web"],
    plugins
  }
];
