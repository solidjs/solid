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

// Build-time regression guard for the frames client entry: the emitted
// chunk must still contain its transport half. `responseHandler` is the
// config write inside installServerComponents and
// `configureServerFunctionsClient` is the (external) import that applies
// it — both were silently tree-shaken out of beta.23/24 when the
// server-function client was bundled as a private copy.
const assertFramesClientTransport = {
  name: "assert-frames-client-transport",
  generateBundle(_, bundle) {
    for (const [fileName, chunk] of Object.entries(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const marker of ["configureServerFunctionsClient", "responseHandler"]) {
        if (!chunk.code.includes(marker)) {
          throw new Error(
            `frames client output ${fileName} lost its transport wiring ("${marker}" missing) — ` +
              "the server-function config call was tree-shaken or removed"
          );
        }
      }
    }
  }
};

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
  },
  {
    input: "serialization/src/index.ts",
    output: [
      {
        file: "serialization/dist/serialization.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "serialization/dist/serialization.js",
        format: "es"
      }
    ],
    external: ["seroval", "seroval-plugins/web"],
    plugins
  },
  // @solidjs/web/data — router-agnostic query()/action() and the single-flight
  // query channel. The isomorphic entry keeps solid-js and the sibling
  // subpaths external (each environment's bundler resolves them per its
  // conditions); the server entry additionally reaches for storage
  // (node:async_hooks), which is why it is a separate subpath.
  {
    input: "data/src/index.ts",
    output: [
      {
        file: "data/dist/data.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "data/dist/data.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/web", "@solidjs/web/server-functions"],
    plugins
  },
  {
    input: "data/src/server.ts",
    output: [
      {
        file: "data/dist/server.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "data/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/web", "@solidjs/web/server-functions", "@solidjs/web/storage"],
    plugins
  },
  {
    input: "server-functions/src/client.ts",
    output: [
      {
        file: "server-functions/dist/client.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "server-functions/dist/client.js",
        format: "es"
      }
    ],
    external: ["seroval", "seroval-plugins/web"],
    plugins
  },
  {
    input: "server-functions/src/server.ts",
    output: [
      {
        file: "server-functions/dist/server.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "server-functions/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js", "seroval", "seroval-plugins/web"],
    plugins
  },
  // @solidjs/web/frames — the server-component transport. The client half
  // bundles the frame runtime (store/morph/host/transport; frame-client is
  // importless by design — cross-bundle seams like the element-claim
  // registry and the FRAME brand ride registered symbols, so this copy and
  // dist/web.js agree by construction). The server-function CLIENT is the
  // exception: it carries the transport config as module state, so it must
  // stay external — the dist imports the same built instance the compiled
  // reference proxies call through (`@solidjs/web/server-functions`, client
  // half). Bundling a private copy breaks instance identity AND lets rollup
  // tree-shake the `configureServerFunctionsClient` call away (this entry
  // never calls the copy's readers, so the config write looks
  // unobservable) — which shipped a frames client with no transport in
  // beta.23/24; assertFramesClientTransport keeps that from regressing.
  // The server half bundles the frame sink and its SSR pipeline (rxcore →
  // src/core, like every entry here).
  {
    input: "frames/src/client.ts",
    output: [
      {
        file: "frames/dist/client.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "frames/dist/client.js",
        format: "es"
      }
    ],
    external: [
      "solid-js",
      "@solidjs/web",
      "seroval",
      "seroval-plugins/web",
      "@solidjs/web/server-functions/client"
    ],
    // Prod build: strip `_DX_DEV_` like the main `dist/web.js` entry, so the
    // frame runtime's dev checks/warnings (marker-integrity diagnostics) do
    // not ship. The dev build below keeps them, selected via the `frames`
    // export's `development` condition — mirroring `web.js`/`dev.js`.
    plugins: [replaceDev(false)].concat(plugins).concat(assertFramesClientTransport)
  },
  {
    // Dev build (`development` export condition): keeps the frame runtime's
    // `_DX_DEV_` diagnostics for marker-corruption / CDN-strip debugging.
    input: "frames/src/client.ts",
    output: [
      {
        file: "frames/dist/client.dev.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "frames/dist/client.dev.js",
        format: "es"
      }
    ],
    external: [
      "solid-js",
      "@solidjs/web",
      "seroval",
      "seroval-plugins/web",
      "@solidjs/web/server-functions/client"
    ],
    plugins: [replaceDev(true)].concat(plugins).concat(assertFramesClientTransport)
  },
  {
    input: "frames/src/server.ts",
    output: [
      {
        file: "frames/dist/server.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "frames/dist/server.js",
        format: "es"
      }
    ],
    external: ["solid-js", "stream", "seroval", "seroval-plugins/web"],
    plugins
  }
];
