import copy from "rollup-plugin-copy";
import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";

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
          replacement: "../../../packages/solid/src/dom/core"
        }
      ]
    ]
  }),
  cleanup({
    extensions: [".js", ".ts"]
  })
];

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "lib/index.js",
        format: "cjs"
      },
      {
        file: "dist/index.js",
        format: "es"
      }
    ],
    plugins: [
      copy({
        targets: [{ src: "../../node_modules/dom-expressions/src/jsx.ts", dest: "./src/rendering" }]
      })
    ].concat(plugins)
  },
  {
    input: "src/dom/index.ts",
    output: [
      {
        file: "lib/dom/index.js",
        format: "cjs"
      },
      {
        file: "dist/dom/index.js",
        format: "es"
      }
    ],
    external: ["../index.js"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/runtime.d.ts"],
            dest: "./src/dom"
          },
          { src: "../../node_modules/dom-expressions/src/runtime.d.ts", dest: "./types/dom/" },
          {
            src: ["../../node_modules/dom-expressions/src/asyncSSR.d.ts"],
            dest: "./src/dom"
          },
          { src: "../../node_modules/dom-expressions/src/asyncSSR.d.ts", dest: "./types/dom/" }
        ]
      })
    ].concat(plugins)
  },
  {
    input: "src/dom/html.ts",
    output: [
      {
        file: "lib/dom/html.js",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "dist/dom/html.js",
        format: "es"
      }
    ],
    external: ["./index.js", "lit-dom-expressions"],
    plugins
  },
  {
    input: "src/dom/h.ts",
    output: [
      {
        file: "lib/dom/h.js",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "dist/dom/h.js",
        format: "es"
      }
    ],
    external: ["./index.js", "hyper-dom-expressions"],
    plugins
  },
  {
    input: "src/server/index.ts",
    output: [
      {
        file: "lib/server/index.js",
        format: "cjs"
      },
      {
        file: "dist/server/index.js",
        format: "es"
      }
    ],
    external: ["stream"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/runtime.d.ts"],
            dest: "./src/server"
          },
          { src: "../../node_modules/dom-expressions/src/runtime.d.ts", dest: "./types/server/" },
          {
            src: ["../../node_modules/dom-expressions/src/ssr.d.ts"],
            dest: "./src/server"
          },
          { src: "../../node_modules/dom-expressions/src/ssr.d.ts", dest: "./types/server/" }
        ]
      }),
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
              replacement: "../../../packages/solid/src/server/core"
            }
          ]
        ]
      }),
      cleanup({
        extensions: [".js", ".ts"]
      })
    ]
  }
];
