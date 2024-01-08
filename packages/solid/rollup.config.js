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
          replacement: fileURLToPath(new URL("web/src/core", import.meta.url))
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
        file: "dist/solid.cjs",
        format: "cjs"
      },
      {
        file: "dist/solid.js",
        format: "es"
      }
    ],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
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
    external: ["stream"],
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
    plugins: [replaceDev(true)].concat(plugins)
  },
  {
    input: "store/src/index.ts",
    output: [
      {
        file: "store/dist/store.cjs",
        format: "cjs"
      },
      {
        file: "store/dist/store.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "store/src/server.ts",
    output: [
      {
        file: "store/dist/server.cjs",
        format: "cjs"
      },
      {
        file: "store/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins
  },
  {
    input: "store/src/index.ts",
    output: [
      {
        file: "store/dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "store/dist/dev.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(true)].concat(plugins)
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
    plugins: [replaceDev(false)].concat(plugins)
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
    external: ["solid-js", "stream", "seroval", "seroval-plugins/web"],
    plugins
  },
  {
    input: "web/src/index.ts",
    output: [
      {
        file: "web/dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "web/dist/dev.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(true)].concat(plugins)
  },
  {
    input: "web/storage/storage.ts",
    output: [
      {
        file: "web/dist/storage.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "web/dist/storage.js",
        format: "es"
      }
    ],
    external: ["solid-js/web"],
    plugins
  },
  {
    input: "universal/src/index.ts",
    output: [
      {
        file: "universal/dist/universal.cjs",
        format: "cjs"
      },
      {
        file: "universal/dist/universal.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "universal/src/index.ts",
    output: [
      {
        file: "universal/dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "universal/dist/dev.js",
        format: "es"
      }
    ],
    external: ["solid-js"],
    plugins: [replaceDev(true)].concat(plugins)
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
    input: "h/jsx-runtime/src/index.ts",
    output: [
      {
        file: "h/jsx-runtime/dist/jsx.cjs",
        format: "cjs"
      },
      {
        file: "h/jsx-runtime/dist/jsx.js",
        format: "es"
      }
    ],
    external: ["solid-js/h"],
    plugins
  }
];
