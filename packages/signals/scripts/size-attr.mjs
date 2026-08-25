import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const res = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  write: false,
  metafile: true,
  define: { __DEV__: "false", __TEST__: "false" },
  treeShaking: true,
  logLevel: "silent"
});
const meta = res.metafile;
const out = Object.values(meta.outputs)[0];
const total = out.bytes;
const rows = Object.entries(out.inputs)
  .map(([f, v]) => [f.replace("src/", ""), v.bytesInOutput])
  .sort((a, b) => b[1] - a[1]);
console.log("minified total:", total, "gzip:", gzipSync(res.outputFiles[0].contents).length);
for (const [f, b] of rows) console.log(String(b).padStart(7), f);
