import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";
import { fileURLToPath } from "node:url";

// Runtime modules still late-load the codec by relative path. Keep those
// imports on the public serialization entries in the packaged output.
const externalizeLazySerializer = {
  name: "externalize-lazy-serializer",
  resolveDynamicImport(specifier) {
    if (typeof specifier === "string" && /[\\/]serializer\.js$/.test(specifier)) {
      return { id: "@solidjs/web/serialization", external: true };
    }
    // The decode half (deserializeStream, frames data tables): reading a
    // payload never needs the encode machinery, so those late-loads resolve
    // to the decode-only entry (~6.5 vs ~13 kB gz).
    if (typeof specifier === "string" && /[\\/]serializer-decode\.js$/.test(specifier)) {
      return { id: "@solidjs/web/serialization/decode", external: true };
    }
    return null;
  }
};

const plugins = [
  externalizeLazySerializer,
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
// The frames client bundles the frame runtime, but the server-function WIRE
// layer it leans on (chunk framing, intrinsic addressing, the codec/flight
// config) must be the same instance the compiled reference proxies call
// through. Resolving frame-transport's shared.js/response.js imports to the
// external client entry keeps exactly one copy of that code in an app AND
// makes the config the transport's defaults read the shared built instance
// by construction — no getter plumbing. A name the client entry stops
// exporting fails the build loudly (missing-export), never silently.
const externalizeSharedTransport = {
  name: "externalize-shared-transport",
  resolveId(source, importer) {
    if (!importer) return null;
    if (
      /[\\/]frame-transport\.js$/.test(importer) &&
      (source === "./server-functions/shared.js" || source === "./response.js")
    ) {
      return { id: "@solidjs/web/server-functions/client", external: true };
    }
    return null;
  }
};

const useLocalServerFunctions = {
  name: "use-local-server-functions",
  resolveId(source, importer) {
    if (
      !importer ||
      !/[\\/]frame-sink\.js$/.test(importer) ||
      (source !== "./server-functions/shared.js" && source !== "./server-functions/server.js")
    ) {
      return null;
    }
    const file = source.endsWith("shared.js") ? "shared.js" : "server.js";
    return fileURLToPath(new URL(`server-functions/src/${file}`, import.meta.url));
  }
};

// The rich-args entry's imports of the server-function client (its config
// write) and shared wire layer (codec read, serializeString) must resolve to
// the same built instance the compiled reference proxies call through —
// bundling a private copy would write `serializeArgs` into config module
// state nothing reads. Same instance-identity reasoning as
// externalizeSharedTransport above; a name the client entry stops exporting
// fails the build loudly (missing-export), never silently.
const externalizeSharedClient = {
  name: "externalize-shared-client",
  resolveId(source, importer) {
    if (!importer || !/[\\/]rich-args\.js$/.test(importer)) return null;
    if (source === "./client.js" || source === "./shared.js") {
      return { id: "@solidjs/web/server-functions/client", external: true };
    }
    return null;
  }
};

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
    // Prod build — the only node/worker/deno artifact for the main entry
    // (SSR builds are production by convention; the server entry hard-codes
    // isDev false). `_DX_DEV_` must strip to false here: without the
    // replace, babel constant-folds the truthy "_DX_DEV_" string literal and
    // the artifact permanently takes the DEV branch of every gate — most
    // damaging the committed-stub header guard, which is spec'd to throw in
    // dev but console.error + no-op in prod, so the shipped bundle turned a
    // late header write into a crashed production request (#2982). Guarded
    // behaviorally by test/server/dist-server-artifact.spec.tsx (a string
    // scan can't catch this: the folding erases the marker either way).
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
    plugins: [replaceDev(false)].concat(plugins)
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
  {
    // The decode half on its own (frames data tables, deserializeStream):
    // lazy client consumers import this specifier so the encode machinery
    // never rides into a browser that only reads. The full entry above
    // still carries everything (its serializer.js re-exports this module).
    input: "serialization/src/decode.ts",
    output: [
      {
        file: "serialization/dist/decode.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "serialization/dist/decode.js",
        format: "es"
      }
    ],
    external: ["seroval", "seroval-plugins/web"],
    plugins
  },
  {
    input: "server-functions/src/client.js",
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
    external: [
      "@solidjs/web/serialization",
      "@solidjs/web/serialization/decode",
      "seroval",
      "seroval-plugins/web"
    ],
    plugins
  },
  {
    // Client opt-in for codec-encoded arguments. Tiny by construction: its
    // client/shared imports resolve to the external client entry (see
    // externalizeSharedClient), so the dist carries only enableRichArguments
    // and pulls the serializer write half through the shared instance.
    input: "server-functions/src/rich-args.js",
    output: [
      {
        file: "server-functions/dist/rich-args.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "server-functions/dist/rich-args.js",
        format: "es"
      }
    ],
    external: ["@solidjs/web/server-functions/client", "seroval", "seroval-plugins/web"],
    plugins: [externalizeSharedClient].concat(plugins)
  },
  {
    // Prod build: `_DX_DEV_` strips to false, which is what gates the
    // handler's error sanitization (plain thrown server-function errors
    // become a generic Error) and its dev-only diagnostic bodies. This is
    // the default resolution — plain node, production bundles.
    input: "server-functions/src/server.js",
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
    external: [
      "solid-js",
      "@solidjs/web/serialization",
      "@solidjs/web/serialization/decode",
      "seroval",
      "seroval-plugins/web"
    ],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    // Dev build (`development` export condition, what Vite dev resolves):
    // keeps full server-function error fidelity (message, stack, own-props)
    // and the handler's diagnostic bodies for DX and the dev toolbar —
    // mirroring the frames client's dev/prod split.
    input: "server-functions/src/server.js",
    output: [
      {
        file: "server-functions/dist/server.dev.cjs",
        format: "cjs",
        exports: "auto"
      },
      {
        file: "server-functions/dist/server.dev.js",
        format: "es"
      }
    ],
    external: [
      "solid-js",
      "@solidjs/web/serialization",
      "@solidjs/web/serialization/decode",
      "seroval",
      "seroval-plugins/web"
    ],
    plugins: [replaceDev(true)].concat(plugins)
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
      "@solidjs/web/server-functions/client",
      // Lazily imported (`prepareData`): the codec loads only when a `data`
      // chunk actually arrives, so the frames client ships seroval-free.
      "@solidjs/web/serialization/decode"
    ],
    // Prod build: strip `_DX_DEV_` like the main `dist/web.js` entry, so the
    // frame runtime's dev checks/warnings (marker-integrity diagnostics) do
    // not ship. The dev build below keeps them, selected via the `frames`
    // export's `development` condition — mirroring `web.js`/`dev.js`.
    plugins: [replaceDev(false), externalizeSharedTransport]
      .concat(plugins)
      .concat(assertFramesClientTransport)
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
      "@solidjs/web/server-functions/client",
      "@solidjs/web/serialization/decode"
    ],
    plugins: [replaceDev(true), externalizeSharedTransport]
      .concat(plugins)
      .concat(assertFramesClientTransport)
  },
  {
    // Prod build, like the main server entry above: the frame sink bundles
    // runtime code with `_DX_DEV_` gates (useHead/insert dev warnings), and
    // without the replace babel folds the truthy literal into the dev branch
    // — same build-mode bug as #2982, dev-only noise shipped in prod here.
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
    external: [
      "solid-js",
      "stream",
      "@solidjs/web/serialization",
      "@solidjs/web/serialization/decode",
      "seroval",
      "seroval-plugins/web"
    ],
    plugins: [replaceDev(false), useLocalServerFunctions].concat(plugins)
  }
];
