// The ratchet: re-bases every cap on what the tree measures now, LOWER ONLY.
// A scenario's new cap is its brotli size + 10 B rounded up to 0.01 KB (the
// convention every cap in scenarios.js was set by); a cap is rewritten only
// when that is below the current cap. Raising stays a decision made in a PR.
// Run per RC, on the release candidate's next, from CI's measurement
// (`--from`): local and CI artifacts differ by tens of brotli bytes.
//
// Each cap carries the minified size recorded when it was set
// (`capMinified`; gate.mjs measures minified growth against it). A lowered
// cap records the minified measured with it — the two are one measurement.
// A cap that is not lowered only ever has its recorded minified LOWERED (or
// recorded for the first time when it has none): raising it would loosen the
// gate exactly as raising the cap would, so that stays a PR decision too.
//
// Inline caps are rewritten in scenarios.js with a dated ledger line above
// each; the frozen floors in floor-caps.json are rewritten too, with their
// ledger line on the scenario in scenarios.js, and are listed in their own
// tables so a floor change is seen as one. Scenarios still over their cap,
// or above their recorded minified, are listed and left alone.
//
// Usage: node ratchet.mjs [--from <size.json>] [--note <text>]
//                         [--minified-only] [--dry-run]
//   --from <file>    ratchet from a size.mjs --json measurement (CI's
//                    size-head artifact of a push to next) instead of
//                    measuring this checkout
//   --note <text>    recorded in each ledger line (e.g. "RC.7, next @ abc1234")
//   --minified-only  leave every cap alone; only record missing minified
//                    sizes and lower recorded ones
//   --dry-run        print the tables, write nothing

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundle, here, scenarios, toBytes } from "./bundle.mjs";

const HEADROOM = 10;

/** Measured brotli + headroom, rounded up to the next 10 B (0.01 KB). */
const capFor = br => Math.ceil((br + HEADROOM) / 10) * 10;
const formatCap = bytes => `${(bytes / 1000).toFixed(2)} KB`;
const fmt = n => n.toLocaleString("en-US");

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fromFile = flag("--from");
const note = flag("--note");
const dryRun = args.includes("--dry-run");
const minifiedOnly = args.includes("--minified-only");

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
const floorCaps = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(floorFile, "utf8"))).map(([name, e]) => [
    name,
    typeof e === "string" ? { cap: e } : e
  ])
);
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
const changed = { inline: [], floor: [] };
const stillOver = [];
const aboveRecorded = [];
for (const scenario of scenarios) {
  const m = measured.find(x => x.name === scenario.name);
  if (!m) {
    console.error(`ratchet: no measurement for "${scenario.name}"; nothing written.`);
    process.exit(1);
  }
  const floor = scenario.name in floorCaps;
  const cap = toBytes(scenario.limit);
  const recorded = scenario.capMinified;
  if (m.size > cap) stillOver.push({ name: scenario.name, cap, size: m.size });

  let newCap = cap;
  let newRecorded = recorded;
  if (!minifiedOnly && capFor(m.size) < cap) {
    newCap = capFor(m.size);
    newRecorded = m.minified;
  } else if (typeof recorded !== "number" || m.minified < recorded) {
    newRecorded = m.minified;
  } else if (m.minified > recorded) {
    aboveRecorded.push({ name: scenario.name, recorded, minified: m.minified });
  }
  if (newCap === cap && newRecorded === recorded) continue;

  const row = {
    name: scenario.name,
    from: formatCap(cap),
    to: formatCap(newCap),
    size: m.size,
    recFrom: recorded,
    recTo: newRecorded
  };
  (floor ? changed.floor : changed.inline).push(row);

  // The scenario's block runs from its `name:` to the next scenario's.
  const start = source.indexOf(`name: ${JSON.stringify(scenario.name)},`);
  if (start < 0) throw new Error(`ratchet: "${scenario.name}" not found in scenarios.js`);
  const end = (i => (i < 0 ? source.length : i))(source.indexOf("\n  {\n    name:", start));
  const block = source.slice(start, end);
  const limitText = floor ? "limit: floorCaps[" : `limit: ${JSON.stringify(scenario.limit)},`;
  const at = block.indexOf(limitText);
  if (at < 0) throw new Error(`ratchet: no \`${limitText}\` line for "${scenario.name}"`);
  const lineStart = block.lastIndexOf("\n", at) + 1;
  const lineEnd = block.indexOf("\n", at);
  const indent = block.slice(lineStart, at);
  const recordedText =
    typeof recorded === "number"
      ? `recorded minified ${fmt(recorded)} -> ${fmt(newRecorded)} B`
      : `recorded minified ${fmt(newRecorded)} B (first record)`;
  const what =
    newCap !== cap
      ? `${row.from} -> ${row.to}, ${recordedText}`
      : `cap unchanged at ${row.from}, ${recordedText}`;
  const ledger =
    `${indent}// Ratchet (${date}${note ? `, ${note}` : ""}): ${what}; ${origin} at\n` +
    `${indent}// ${fmt(m.size)} B (${fmt(m.minified)} B minified). Lower only: cap at measured\n` +
    `${indent}// + ${HEADROOM} B rounded up to 0.01 KB; recorded minified never raised.\n`;

  let limitLine = block.slice(lineStart, lineEnd);
  let after = block.slice(lineEnd);
  if (floor) {
    floorCaps[scenario.name] = { cap: row.to, minified: newRecorded };
  } else {
    if (newCap !== cap)
      limitLine = limitLine.replace(limitText, `limit: ${JSON.stringify(row.to)},`);
    const recordedLine = /\n *capMinified: \d+,/;
    after = recordedLine.test(after)
      ? after.replace(recordedLine, `\n${indent}capMinified: ${newRecorded},`)
      : `\n${indent}capMinified: ${newRecorded},` + after;
  }
  source =
    source.slice(0, start) +
    block.slice(0, lineStart) +
    ledger +
    limitLine +
    after +
    source.slice(end);
}

const table = rows =>
  [
    "| scenario | cap | new cap | measured | recorded minified | new recorded |",
    "| --- | ---: | ---: | ---: | ---: | ---: |"
  ]
    .concat(
      rows.map(
        r =>
          `| ${r.name} | ${r.from} | ${r.to === r.from ? "—" : r.to} | ${r.size} B | ${r.recFrom ?? "none"} | ${r.recTo} |`
      )
    )
    .join("\n");

console.log(
  `ratchet: ${origin}${note ? `, ${note}` : ""}${minifiedOnly ? " (minified only)" : ""}${dryRun ? " (dry run)" : ""}\n`
);
console.log(`Inline caps changed (scenarios.js): ${changed.inline.length}`);
if (changed.inline.length) console.log(table(changed.inline));
console.log(`\nFROZEN FLOOR caps changed (floor-caps.json): ${changed.floor.length}`);
if (changed.floor.length) console.log(table(changed.floor));
const pairedUp = [...changed.inline, ...changed.floor].filter(
  r => r.to !== r.from && typeof r.recFrom === "number" && r.recTo > r.recFrom
);
if (pairedUp.length)
  console.log(
    `\nRecorded minified went UP with a lowered cap (one measurement, brotli shrank): ${pairedUp.length}\n` +
      pairedUp.map(r => `  ${r.name}: ${r.recFrom} -> ${r.recTo} B`).join("\n")
  );
if (stillOver.length)
  console.log(
    `\nStill over their cap (not raised — the ratchet only lowers): ${stillOver.length}\n` +
      stillOver
        .map(s => `  ${s.name}: ${s.size} B > ${formatCap(s.cap)} (+${s.size - s.cap} B)`)
        .join("\n")
  );
if (aboveRecorded.length)
  console.log(
    `\nAbove their recorded minified (not raised): ${aboveRecorded.length}\n` +
      aboveRecorded
        .map(s => `  ${s.name}: ${s.minified} B > ${s.recorded} B (+${s.minified - s.recorded} B)`)
        .join("\n")
  );

if (!dryRun && (changed.inline.length || changed.floor.length)) {
  writeFileSync(scenariosFile, source);
  writeFileSync(floorFile, JSON.stringify(floorCaps, null, 2) + "\n");
  console.log("\nratchet: scenarios.js and floor-caps.json rewritten.");
} else if (!dryRun) {
  console.log("\nratchet: nothing to change.");
}
