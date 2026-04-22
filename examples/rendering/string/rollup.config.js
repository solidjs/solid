import path from "path";
import nodeResolve from "@rollup/plugin-node-resolve";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import copy from "rollup-plugin-copy";
import fs from "fs";

const componentsDir = path.resolve("shared/src/components");
const manifestPath = path.resolve("string/public/js/asset-manifest.json");
const extensions = [".js", ".jsx", ".ts", ".tsx"];

function solidAssetManifest() {
  return {
    name: "solid-asset-manifest",
    generateBundle(options, bundle) {
      const manifest = {};
      const chunkKeyByFileName = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.facadeModuleId) continue;
        const rel =
          "./" + path.relative(componentsDir, chunk.facadeModuleId).replace(/\.[jt]sx?$/, "");
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

function virtualAssetManifest() {
  const VIRTUAL_ID = "virtual:asset-manifest";
  const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
  return {
    name: "virtual-asset-manifest",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      return `export default ${JSON.stringify(manifest, null, 2)}`;
    }
  };
}

export default [
  {
    input: "./string/client.tsx",
    output: [
      {
        dir: "string/public/js",
        format: "esm"
      }
    ],
    preserveEntrySignatures: false,
    plugins: [
      nodeResolve({ exportConditions: ["solid", "development"], extensions }),
      babel({
        extensions,
        exclude: "node_modules/**",
        babelHelpers: "bundled",
        presets: [
          ["solid", { generate: "dom", hydratable: true, dev: true }],
          "@babel/preset-typescript"
        ]
      }),
      common(),
      solidAssetManifest(),
      copy({
        targets: [
          {
            src: ["shared/static/*"],
            dest: "string/public"
          }
        ]
      })
    ]
  },
  {
    input: "./string/index.tsx",
    output: [
      {
        dir: "string/lib",
        format: "esm"
      }
    ],
    external: ["solid-js", "@solidjs/web", "path", "express", "fs", "url"],
    plugins: [
      nodeResolve({ preferBuiltins: true, exportConditions: ["solid", "node"], extensions }),
      babel({
        extensions,
        exclude: "node_modules/**",
        babelHelpers: "bundled",
        presets: [["solid", { generate: "ssr", hydratable: true }], "@babel/preset-typescript"]
      }),
      common(),
      virtualAssetManifest()
    ],
    preserveEntrySignatures: false
  }
];
