// The size gate: bundles every scenario in scenarios.js with Rolldown and
// fails when an eager entry chunk exceeds its cap. Prints, per scenario, the
// brotli and minified size of the entry chunk, the cap, the lazy chunks a
// page would fetch later (reported, never counted), and the per-package
// minified split so a bump is attributed in the log that reports it.
//
// Usage: node size.mjs [--json <file>] [scenario-substring ...]
//   --json <file>  also write the results (for the PR compare comment)

import { writeFileSync } from "node:fs";
import { bundle, packageOf, scenarios, toBytes, toKB } from "./bundle.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : null;
const filters = args.filter((a, i) => !a.startsWith("--") && i !== jsonAt + 1);

const results = [];
let failed = false;
for (const scenario of scenarios) {
  if (filters.length && !filters.some(f => scenario.name.includes(f))) continue;
  let r;
  try {
    r = await bundle(scenario);
  } catch (err) {
    // A scenario that cannot bundle is a failure of the gate, but the other
    // scenarios still report (and the JSON still carries the error, so the
    // compare comment can show it instead of vanishing).
    failed = true;
    results.push({
      name: scenario.name,
      limit: toBytes(scenario.limit),
      error: String(err?.message ?? err)
    });
    console.log(
      `\nFAIL ${scenario.name}\n     ${String(err?.message ?? err)
        .split("\n")
        .filter(Boolean)
        .slice(0, 3)
        .join("\n     ")}`
    );
    continue;
  }
  const cap = toBytes(r.limit);
  const over = r.br > cap;
  failed ||= over;
  const byPackage = new Map();
  for (const { id, min } of r.modules) {
    const pkg = packageOf(id);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + min);
  }
  const packages = [...byPackage].sort((a, b) => b[1] - a[1]);
  results.push({
    name: r.name,
    size: r.br,
    minified: r.min,
    limit: cap,
    passed: !over,
    lazy: r.lazy,
    packages: Object.fromEntries(packages)
  });

  console.log(`\n${over ? "FAIL" : "ok  "} ${r.name}`);
  console.log(
    `     brotli ${toKB(r.br)} (${r.br} B)  minified ${r.min} B  cap ${r.limit}${over ? `  — over by ${r.br - cap} B` : ""}`
  );
  if (r.lazy.length)
    console.log(
      `     lazy (not counted): ${r.lazy.map(c => `${c.name} ${toKB(c.br)}`).join(", ")}`
    );
  console.log(`     ${packages.map(([p, b]) => `${p}=${b}`).join("  ")}`);
}

if (jsonFile) writeFileSync(jsonFile, JSON.stringify(results, null, 2));
console.log(
  failed
    ? "\nsize: a scenario exceeds its cap or failed to bundle."
    : "\nsize: every scenario within its cap."
);
process.exit(failed ? 1 : 0);
