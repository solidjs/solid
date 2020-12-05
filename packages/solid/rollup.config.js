import copy from "rollup-plugin-copy";
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
    presets: ["@babel/preset-typescript"],
    plugins: [
      [
        "babel-plugin-transform-rename-import",
        {
          original: "rxcore",
          replacement: `../../../packages/solid/web/src/core`
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
        file: "dist/solid.cjs",
        format: "cjs"
      },
      {
        file: "dist/solid.js",
        format: "es"
      }
    ],
    plugins: [
      replace({
        '"_SOLID_DEV_"': false,
        delimiters: ["", ""]
      }),
      copy({
        targets: [
          {
            src: "./src/jsx.d.ts",
            dest: "./types/"
          }
        ]
      })
    ].concat(plugins)
  },
  {
    input: "src/static/index.ts",
    output: [
      {
        file: "dist/static.cjs",
        format: "cjs"
      },
      {
        file: "dist/static.js",
        format: "es"
      }
    ],
    external: ["stream"],
    plugins
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dev/dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "dev/dist/dev.js",
        format: "es"
      }
    ],
    plugins
  },
  {
    input: "web/src/index.ts",
    output: [
      {
        file: "web/dist/web.cjs",
        format: "cjs"
      },
      {
        file: "web/dist/web.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/runtime.d.ts"],
            dest: "./web/src/"
          },
          { src: "../../node_modules/dom-expressions/src/runtime.d.ts", dest: "./web/types/" }
        ]
      })
    ].concat(plugins)
  },
  {
    input: "html/src/index.ts",
    output: [
      {
        file: "html/dist/html.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "html/dist/html.js",
        format: "es"
      }
    ],
    external: ["solid-js/web"],
    plugins
  },
  {
    input: "h/src/index.ts",
    output: [
      {
        file: "h/dist/h.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "h/dist/h.js",
        format: "es"
      }
    ],
    external: ["solid-js/web"],
    plugins
  },
  {
    input: "web/server/index.ts",
    output: [
      {
        file: "web/dist/server.cjs",
        format: "cjs"
      },
      {
        file: "web/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js", "stream"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/syncSSR.d.ts"],
            dest: "./web/server"
          }
        ]
      })
    ].concat(plugins)
  },
  {
    input: "web/server-async/index.ts",
    output: [
      {
        file: "web/dist/server-async.cjs",
        format: "cjs"
      },
      {
        file: "web/dist/server-async.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/asyncSSR.d.ts"],
            dest: "./web/server-async"
          }
        ]
      })
    ].concat(plugins)
  }
];
