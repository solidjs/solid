// The floor caps are frozen: a PR may lower them, never raise them, unless it
// carries an explicit exception. size-limit enforces the caps themselves;
// this enforces that the caps did not move.
//
// Why a separate check: for ten weeks the floor scenarios grew through
// individually justified 10–300 B bumps (7.1 → 9.8 KB brotli on the signals
// floor), each recorded in .size-limit.js and none resisted. Moving the three
// floor caps into floor-caps.json and diffing that file against the base
// branch turns a bump from a paragraph into a decision the reviewer sees.
//
// Usage: node check-floor-caps.mjs <base-ref>
//   Compares floor-caps.json at HEAD with the same file at <base-ref>. Exits
//   non-zero if any cap increased, unless SIZE_EXCEPTION (the PR body, in CI)
//   contains a line starting with "Size-Exception:" that names the reason.
//   A cap absent at the base (a new floor scenario) is allowed.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2];
if (!base) {
  console.error("usage: node check-floor-caps.mjs <base-ref>");
  process.exit(2);
}

// size-limit's units are decimal (1 KB = 1000 B).
const toBytes = s => {
  const m = String(s)
    .trim()
    .match(/^([\d.]+)\s*(B|KB|MB)?$/i);
  if (!m) throw new Error(`unparseable cap "${s}"`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  return unit === "MB" ? n * 1e6 : unit === "KB" ? n * 1e3 : n;
};

const head = JSON.parse(readFileSync(join(here, "floor-caps.json"), "utf8"));
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: here,
  encoding: "utf8"
}).trim();
const relPath = relative(repoRoot, join(here, "floor-caps.json"));
let baseCaps = {};
try {
  baseCaps = JSON.parse(
    execFileSync("git", ["show", `${base}:${relPath}`], { cwd: repoRoot, encoding: "utf8" })
  );
} catch {
  console.log(`floor-caps: ${relPath} absent at ${base}; nothing to compare.`);
  process.exit(0);
}

const exception = /^\s*Size-Exception:\s*\S/m.test(process.env.SIZE_EXCEPTION ?? "");
let raised = [];
for (const [name, cap] of Object.entries(head)) {
  if (!(name in baseCaps)) continue;
  const before = toBytes(baseCaps[name]);
  const after = toBytes(cap);
  if (after > before) raised.push(`  ${name}: ${baseCaps[name]} -> ${cap}`);
}

if (raised.length === 0) {
  console.log("floor-caps: no cap raised.");
} else if (exception) {
  console.log("floor-caps: cap(s) raised under an explicit Size-Exception:\n" + raised.join("\n"));
} else {
  console.error(
    "floor-caps: a frozen floor cap was raised without an exception:\n" +
      raised.join("\n") +
      "\n\nRelocate the retained bytes out of the floor instead (the winning move is a\n" +
      "pay-for-use module; see .cursor/rules/signals.mdc), or — if the maintainer has\n" +
      "accepted the cost — add a line to the PR body:\n\n" +
      "  Size-Exception: <why this floor cost is accepted>\n"
  );
  process.exit(1);
}
