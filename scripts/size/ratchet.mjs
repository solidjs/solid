// The ratchet: re-bases every cap on what the tree measures now, LOWER ONLY.
// A scenario's new cap is its brotli size + 10 B rounded up to 0.01 KB (the
// convention every cap in scenarios.js was set by); a cap is rewritten only
// when that is below the current cap. Raising stays a decision made in a PR.
// Run per RC, on the release candidate's next, from CI's measurement
// (`--from`): local and CI artifacts differ by tens of brotli bytes.
//
// Inline caps are rewritten in scenarios.js with a dated ledger line above
// each; the frozen floors in floor-caps.json are rewritten too, with their
// ledger line on the scenario in scenarios.js, and are listed in their own
// table so a floor change is seen as one. Scenarios still over their cap
// after re-measuring are listed and left alone: the ratchet does not raise.
//
// Usage: node ratchet.mjs [--from <size.json>] [--note <text>] [--dry-run]
//   --from <file>  ratchet from a size.mjs --json measurement (CI's
//                  size-head artifact of a push to next) instead of
//                  measuring this checkout
//   --note <text>  recorded in each ledger line (e.g. "RC.7, next @ abc1234")
//   --dry-run      print the tables, write nothing

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundle, here, scenarios, toBytes } from "./bundle.mjs";

const HEADROOM = 10;

/** Measured brotli + headroom, rounded up to the next 10 B (0.01 KB). */
const capFor = br => Math.ceil((br + HEADROOM) / 10) * 10;
const formatCap = bytes => `${(bytes / 1000).toFixed(2)} KB`;

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fromFile = flag("--from");
const note = flag("--note");
const dryRun = args.includes("--dry-run");

let measured;
if (fromFile) {
  measured = JSON.parse(readFileSync(fromFile, "utf8"));
} else {
  measured = [];
  for (const scenario of scenarios) {
    try {
      const r = await bundle(scenario);
      measured.push({ name: r.name, size: r.br, minified: r.min });
    } catch (err) {
      measured.push({ name: scenario.name, error: String(err?.message ?? err) });
    }
  }
}

const floorFile = join(here, "floor-caps.json");
const scenariosFile = join(here, "scenarios.js");
const floorCaps = JSON.parse(readFileSync(floorFile, "utf8"));
let source = readFileSync(scenariosFile, "utf8");

const errors = measured.filter(m => m.error);
if (errors.length) {
  console.error(
    `ratchet: ${errors.map(m => m.name).join(", ")} failed to bundle; nothing written.`
  );
  process.exit(1);
}

const date = new Date().toLocaleDateString("en-CA");
const origin = fromFile ? "CI-measured" : `measured locally (${process.platform})`;
const lowered = { inline: [], floor: [] };
const stillOver = [];
for (const scenario of scenarios) {
  const m = measured.find(x => x.name === scenario.name);
  if (!m) {
    console.error(`ratchet: no measurement for "${scenario.name}"; nothing written.`);
    process.exit(1);
  }
  const cap = toBytes(scenario.limit);
  const next = capFor(m.size);
  if (m.size > cap)
    stillOver.push({ name: scenario.name, cap, size: m.size, minified: m.minified });
  if (next >= cap) continue;
  const floor = scenario.name in floorCaps;
  const row = {
    name: scenario.name,
    from: formatCap(cap),
    to: formatCap(next),
    size: m.size,
    minified: m.minified
  };
  (floor ? lowered.floor : lowered.inline).push(row);

  // The scenario's block runs from its `name:` to the next scenario's.
  const start = source.indexOf(`name: ${JSON.stringify(scenario.name)},`);
  if (start < 0) throw new Error(`ratchet: "${scenario.name}" not found in scenarios.js`);
  const end = (i => (i < 0 ? source.length : i))(source.indexOf("\n  {\n    name:", start));
  const block = source.slice(start, end);
  const limitText = floor ? "limit: floorCaps[" : `limit: ${JSON.stringify(scenario.limit)},`;
  const at = block.indexOf(limitText);
  if (at < 0) throw new Error(`ratchet: no \`${limitText}\` line for "${scenario.name}"`);
  const lineStart = block.lastIndexOf("\n", at) + 1;
  const indent = block.slice(lineStart, at);
  const ledger =
    `${indent}// Ratchet (${date}${note ? `, ${note}` : ""}): ${row.from} -> ${row.to}, ${origin} at\n` +
    `${indent}// ${m.size.toLocaleString("en-US")} B (${m.minified.toLocaleString("en-US")} B minified). ` +
    `Lower only: measured + ${HEADROOM} B rounded up to 0.01 KB.\n`;
  const rest = floor
    ? block.slice(lineStart)
    : block.slice(lineStart).replace(limitText, `limit: ${JSON.stringify(row.to)},`);
  if (floor) floorCaps[scenario.name] = row.to;
  source = source.slice(0, start) + block.slice(0, lineStart) + ledger + rest + source.slice(end);
}

const table = rows =>
  ["| scenario | cap | measured | new cap |", "| --- | ---: | ---: | ---: |"]
    .concat(rows.map(r => `| ${r.name} | ${r.from} | ${r.size} B | ${r.to} |`))
    .join("\n");

console.log(`ratchet: ${origin}${note ? `, ${note}` : ""}${dryRun ? " (dry run)" : ""}\n`);
console.log(`Inline caps lowered (scenarios.js): ${lowered.inline.length}`);
if (lowered.inline.length) console.log(table(lowered.inline));
console.log(`\nFROZEN FLOOR caps lowered (floor-caps.json): ${lowered.floor.length}`);
if (lowered.floor.length) console.log(table(lowered.floor));
if (stillOver.length) {
  console.log(
    `\nStill over their cap (not raised — the ratchet only lowers): ${stillOver.length}\n` +
      stillOver
        .map(s => `  ${s.name}: ${s.size} B > ${formatCap(s.cap)} (+${s.size - s.cap} B)`)
        .join("\n")
  );
}

if (!dryRun && (lowered.inline.length || lowered.floor.length)) {
  writeFileSync(scenariosFile, source);
  writeFileSync(floorFile, JSON.stringify(floorCaps, null, 2) + "\n");
  console.log("\nratchet: scenarios.js and floor-caps.json rewritten.");
} else if (!dryRun) {
  console.log("\nratchet: no cap to lower.");
}
