import { transform } from "./index.js";
import { transformSync } from "@babel/core";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const babelPlugin = req("../babel-plugin/index.js");

const CASES = {
  "jfb row (mixed residual)": `function Row(row, selection) {
  return <tr class={row.selected ? "danger" : ""}>
    <td textContent={row.label} />
    <td data-sel={selection[row.id] ? "y" : "n"} />
  </tr>;
}`,
  "dbmon row (deep chains)": `function Row(db) {
  return <tr>
    <td class="dbname" textContent={db.name} />
    <td class={db.countClass} textContent={db.count} />
    <td class={db.queries[0].className} textContent={db.queries[0].elapsed} />
  </tr>;
}`,
  "depth-1 flat": `function Row(row) { return <td textContent={row.label} />; }`,
  "declines: reassigned subject": `function f() { let row = a(); row = b(); return <td textContent={row.label} />; }`,
  "declines: no subject": `function f(get) { return <td textContent={get()} />; }`
};

let fail = 0;
for (const [name, src] of Object.entries(CASES)) {
  const babelOut = transformSync(src, {
    babelrc: false, configFile: false,
    plugins: [[babelPlugin, { moduleName: "@solidjs/web", regions: true }]],
    parserOpts: { plugins: ["jsx"] }
  }).code.trim();
  const oxcOut = (await transform(src, { moduleName: "@solidjs/web", regions: true })).code.trim();
  const same = babelOut === oxcOut;
  console.log(same ? "OK  " : "DIFF", name);
  if (!same) {
    fail++;
    const b = babelOut.split("\n"), o = oxcOut.split("\n");
    for (let i = 0; i < Math.max(b.length, o.length); i++) {
      if (b[i] !== o[i]) {
        console.log(`  line ${i + 1}:`);
        console.log(`    babel: ${b[i]}`);
        console.log(`    oxc:   ${o[i]}`);
      }
    }
  }
}
process.exit(fail ? 1 : 0);
