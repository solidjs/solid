import path from "path";
import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";

const componentsDir = path.resolve("shared/src/components");

function solidAssetManifest() {
  return {
    name: "solid-asset-manifest",
    generateBundle(options, bundle) {
      const manifest = {};
      const chunkKeyByFileName = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.facadeModuleId) continue;
        const rel = "./" + path.relative(componentsDir, chunk.facadeModuleId).replace(/\.js$/, "");
        if (rel.startsWith("./..")) continue;
        chunkKeyByFileName[fileName] = rel;
      }
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.facadeModuleId) continue;
        const rel = chunkKeyByFileName[fileName];
        if (!rel) continue;
        const entry = { file: "js/" + fileName };
        if (chunk.isEntry) entry.isEntry = true;
        if (chunk.isDynamicEntry) entry.isDynamicEntry = true;
        const imports = chunk.imports
          .filter(imp => chunkKeyByFileName[imp])
          .map(imp => chunkKeyByFileName[imp]);
        if (imports.length) entry.imports = imports;
        manifest[rel] = entry;
      }
      this.emitFile({
        type: "asset",
        fileName: "asset-manifest.json",
        source: JSON.stringify(manifest, null, 2)
      });
    }
  };
}

export default [
  {
    input: "./stream/index.js",
    preserveEntrySignatures: false,
    output: [
      {
        dir: "stream/lib",
        format: "esm"
      }
    ],
    external: ["solid-js", "@solidjs/web", "path", "express", "fs", "url"],
    plugins: [
      nodeResolve({ preferBuiltins: true, exportConditions: ["solid", "node"] }),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "ssr", hydratable: true }]]
      }),
      common()
    ]
  },
  {
    input: "shared/src/index.js",
    output: [
      {
        dir: "stream/public/js",
        format: "esm"
      }
    ],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve({ exportConditions: ["solid"] }),
      babel({
        babelHelpers: "bundled",
        presets: [["solid", { generate: "dom", hydratable: true }]]
      }),
      common(),
      solidAssetManifest(),
      copy({
        targets: [
          {
            src: ["shared/static/*"],
            dest: "stream/public"
          }
        ]
      })
    ]
  }
];
