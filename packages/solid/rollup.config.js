import copy from "rollup-plugin-copy";
import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";

const plugins = (p) => [
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
          replacement: `../../../packages/solid/${p}/src/core`
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
        file: "dist/solid.cjs.js",
        format: "cjs"
      },
      {
        file: "dist/solid.js",
        format: "es"
      }
    ],
    plugins: [
      copy({
        targets: [{ src: "../../node_modules/dom-expressions/src/jsx.ts", dest: "./src/render" }]
      }),
      replace({
        '"_SOLID_DEV_"': false,
        delimiters: ["", ""]
      })
    ].concat(plugins("solid"))
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dev/dist/dev.cjs.js",
        format: "cjs"
      },
      {
        file: "dev/dist/dev.js",
        format: "es"
      }
    ],
    plugins: plugins("dev")
  },
  {
    input: "static/src/index.ts",
    output: [
      {
        file: "static/dist/static.cjs.js",
        format: "cjs"
      },
      {
        file: "static/dist/static.js",
        format: "es"
      }
    ],
    external: ["stream"],
    plugins: [
      copy({
        targets: [{ src: "../../node_modules/dom-expressions/src/jsx.ts", dest: "./static/src" }]
      })
    ].concat(plugins("static"))
  },
  {
    input: "web/src/index.ts",
    output: [
      {
        file: "web/dist/web.cjs.js",
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
          { src: "../../node_modules/dom-expressions/src/runtime.d.ts", dest: "./web/types/" },
        ]
      })
    ].concat(plugins("web"))
  },
  {
    input: "html/src/index.ts",
    output: [
      {
        file: "html/dist/html.cjs.js",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "html/dist/html.js",
        format: "es"
      }
    ],
    external: ["solid-js/web"],
    plugins: plugins("web")
  },
  {
    input: "h/src/index.ts",
    output: [
      {
        file: "h/dist/h.cjs.js",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "h/dist/h.js",
        format: "es"
      }
    ],
    external: ["solid-js/web"],
    plugins: plugins("web")
  },
  {
    input: "server/src/index.ts",
    output: [
      {
        file: "server/dist/server.cjs.js",
        format: "cjs"
      },
      {
        file: "server/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js/static", "stream"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/syncSSR.d.ts"],
            dest: "./server/src"
          }
        ]
      })].concat(plugins("server"))
  },
  {
    input: "server-async/src/index.ts",
    output: [
      {
        file: "server-async/dist/server-async.cjs.js",
        format: "cjs"
      },
      {
        file: "server-async/dist/server-async.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [
      copy({
        targets: [
          {
            src: ["../../node_modules/dom-expressions/src/asyncSSR.d.ts"],
            dest: "./server-async/src"
          }
        ]
      })
    ].concat(plugins("server-async"))
  }
];
