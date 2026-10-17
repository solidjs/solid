#!/usr/bin/env node
/**
 * Generates `packages/solid/diagnostics.json` — the machine-readable catalog
 * of Solid's dev diagnostic codes — from the three hand-maintained sources:
 *
 * - the `DiagnosticCode` union in `packages/signals/src/core/dev.ts` (the set
 *   of codes; also the `DiagnosticKind` and `DiagnosticSeverity` unions that
 *   every `kind`/`severity` value is validated against),
 * - the "Diagnostic codes (quick reference)" table in
 *   `documentation/solid-2.0/08-dev-diagnostics.md` (severity, category,
 *   trigger per code),
 * - the per-code sections of
 *   `packages/solid/skills/reactivity-diagnostics/SKILL.md` (the repair: the
 *   first sentence of the code's section, or null when the skill has none).
 *
 * Each entry is `{ code, kind, severity, category, trigger, repair, guideUrl }`:
 * `category` is the RFC's Category cell verbatim; `kind` is that cell split
 * into `DiagnosticKind` values (an array: a code may report under more than
 * one kind); `severity` is
 * the RFC's Severity cell split the same way into `DiagnosticSeverity` values
 * (`["info", "warn"]` when the tier depends on the finding); `guideUrl` is the
 * code's page on the docs site (what `DEV.guideUrl(code)` returns).
 *
 * Plain Node, no dependencies. Run from anywhere:
 *
 *   node scripts/generate-diagnostics-json.mjs            # writes the file
 *   node scripts/generate-diagnostics-json.mjs --check    # exit 1 when stale
 *
 * `packages/solid/test/diagnostics-catalog.spec.ts` imports the parsers below
 * and fails when the sources (or the committed file) disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEV_TS = "packages/signals/src/core/dev.ts";
export const RFC_MD = "documentation/solid-2.0/08-dev-diagnostics.md";
export const SKILL_MD = "packages/solid/skills/reactivity-diagnostics/SKILL.md";
export const OUTPUT_JSON = "packages/solid/diagnostics.json";
/** The docs site's page per code — the same URL `DEV.guideUrl` builds. */
export const GUIDE_BASE_URL = "https://v2.solidjs.com/reference/solid-js/diagnostics/";

const RFC_HEADING = "## Diagnostic codes (quick reference)";

/** The one abbreviation the RFC table uses for a severity tier. */
const SEVERITY_ALIASES = { err: "error" };

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** The members of an exported string-literal union type, in source order. */
function parseStringUnion(source, typeName, file) {
  const match = source.match(new RegExp(`export type ${typeName} =([^;]*);`));
  if (!match) throw new Error(`${file}: could not find \`export type ${typeName}\``);
  // Strip comments before collecting literals so a commented example does not count.
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const members = [...body.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (members.length === 0) throw new Error(`${file}: \`${typeName}\` has no string members`);
  return members;
}

/**
 * `dev.ts`: the `DiagnosticCode` union plus the `DiagnosticKind` and
 * `DiagnosticSeverity` unions used to validate the RFC's cells.
 */
export function parseDevTs(source, file = DEV_TS) {
  return {
    codes: parseStringUnion(source, "DiagnosticCode", file),
    kinds: parseStringUnion(source, "DiagnosticKind", file),
    severities: parseStringUnion(source, "DiagnosticSeverity", file)
  };
}

/** Markdown table row → trimmed cells (the leading/trailing pipes dropped). */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim());
}

/**
 * The RFC quick-reference table: `Map<code, { severity, category, trigger }>`
 * with the cells verbatim (severity/category not yet split or validated).
 */
export function parseRfcTable(source, file = RFC_MD) {
  const start = source.indexOf(RFC_HEADING);
  if (start === -1) throw new Error(`${file}: could not find "${RFC_HEADING}"`);
  const next = source.indexOf("\n## ", start + RFC_HEADING.length);
  const section = source.slice(start, next === -1 ? undefined : next);
  const lines = section.split("\n").filter(line => line.trim().startsWith("|"));
  if (lines.length < 2) throw new Error(`${file}: no table under "${RFC_HEADING}"`);
  const header = splitRow(lines[0]).map(cell => cell.toLowerCase());
  const column = name => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`${file}: table has no "${name}" column (${header})`);
    return index;
  };
  const codeAt = column("code");
  const severityAt = column("severity");
  const categoryAt = column("category");
  const triggerAt = column("trigger");
  const rows = new Map();
  for (const line of lines.slice(2)) {
    const cells = splitRow(line);
    const codeCell = cells[codeAt] ?? "";
    const code = codeCell.replace(/^`|`$/g, "");
    if (!/^[A-Z][A-Z0-9_]*$/.test(code))
      throw new Error(`${file}: row has no code in its Code cell: ${line.trim()}`);
    if (rows.has(code)) throw new Error(`${file}: \`${code}\` appears twice in the table`);
    rows.set(code, {
      severity: cells[severityAt] ?? "",
      category: cells[categoryAt] ?? "",
      trigger: cells[triggerAt] ?? ""
    });
  }
  return rows;
}

/**
 * The skill's code sections: `Map<code, firstSentence>`. A section is a
 * `### CODE` heading, or a `#### CODE` heading under a combined
 * `### CODE_A / CODE_B` heading; every code named in a combined heading must
 * have its own `####` sub-section. Headings that are not codes (`### Where to
 * start: ...`) are ignored.
 */
export function parseSkillSections(source, file = SKILL_MD) {
  const lines = source.split("\n");
  const sections = new Map();
  const combined = new Map(); // code → the `###` heading line that named it
  for (let i = 0; i < lines.length; i++) {
    const h3 = lines[i].match(/^###\s+(\S.*?)\s*$/);
    if (h3) {
      const names = h3[1].split("/").map(part => part.trim());
      if (!names.every(name => /^[A-Z][A-Z0-9_]*$/.test(name))) continue;
      if (names.length === 1) {
        addSection(names[0], i);
      } else {
        for (const name of names) combined.set(name, i + 1);
      }
      continue;
    }
    const h4 = lines[i].match(/^####\s+([A-Z][A-Z0-9_]*)\s*$/);
    if (h4) addSection(h4[1], i);
  }
  for (const [code, line] of combined) {
    if (!sections.has(code))
      throw new Error(
        `${file}:${line}: \`${code}\` is named in a combined heading but has no \`#### ${code}\` section`
      );
  }
  return sections;

  function addSection(code, index) {
    if (sections.has(code)) throw new Error(`${file}:${index + 1}: \`${code}\` has two sections`);
    sections.set(code, firstSentence(lines, index + 1));
  }
}

/** The first sentence of the first paragraph after a heading (null if none). */
function firstSentence(lines, from) {
  let i = from;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || /^#{1,6}\s/.test(lines[i])) return null;
  const paragraph = [];
  while (i < lines.length && lines[i].trim() !== "" && !/^#{1,6}\s/.test(lines[i])) {
    paragraph.push(lines[i].trim());
    i++;
  }
  const text = paragraph.join(" ");
  // A sentence ends at `.`, `!` or `?` followed by whitespace (or the end of
  // the paragraph), outside inline code — "e.g." and `foo.bar` do not count.
  let inCode = false;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (ch === "`") inCode = !inCode;
    if (inCode || !".!?".includes(ch)) continue;
    const nextCh = text[j + 1];
    const closesSentence = nextCh === undefined || /\s/.test(nextCh);
    if (closesSentence && !ABBREVIATIONS.has(lastWord(text.slice(0, j))))
      return text.slice(0, j + 1);
  }
  return text;
}

/** Words whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set(["e.g", "i.e", "cf", "vs", "etc"]);

/** The word before a period: the text after the last whitespace or bracket. */
function lastWord(text) {
  return text.slice(text.search(/[^\s([]*$/)).toLowerCase();
}

/** Split a `warn/err`-style cell into validated union members. */
function splitCell(cell, allowed, aliases, what, code, file) {
  const parts = cell
    .split("/")
    .map(part => part.trim())
    .map(part => aliases[part] ?? part);
  if (parts.length === 0 || parts.some(part => part === ""))
    throw new Error(`${file}: \`${code}\` has an empty ${what} cell`);
  for (const part of parts) {
    if (!allowed.includes(part))
      throw new Error(
        `${file}: \`${code}\` ${what} "${part}" is not a member of the union in ${DEV_TS} (${allowed.join(", ")})`
      );
  }
  return parts;
}

export function guideUrl(code) {
  return GUIDE_BASE_URL + code.toLowerCase().replace(/_/g, "-");
}

/** Read the three sources from `root`. */
export function readSources(root = repoRoot()) {
  const read = file => readFileSync(join(root, file), "utf8");
  return {
    dev: parseDevTs(read(DEV_TS)),
    rfc: parseRfcTable(read(RFC_MD)),
    skill: parseSkillSections(read(SKILL_MD))
  };
}

/**
 * The catalog, sorted by code. Every code in the union must have an RFC row;
 * a missing skill section yields `repair: null` (the agreement test, not the
 * generator, decides whether that is acceptable).
 */
export function buildCatalog({ dev, rfc, skill }) {
  const missing = dev.codes.filter(code => !rfc.has(code));
  if (missing.length)
    throw new Error(
      `${RFC_MD}: no quick-reference row for ${missing.map(c => `\`${c}\``).join(", ")}`
    );
  return [...dev.codes].sort().map(code => {
    const row = rfc.get(code);
    return {
      code,
      kind: splitCell(row.category, dev.kinds, {}, "category", code, RFC_MD),
      severity: splitCell(row.severity, dev.severities, SEVERITY_ALIASES, "severity", code, RFC_MD),
      category: row.category,
      trigger: row.trigger,
      repair: skill.get(code) ?? null,
      guideUrl: guideUrl(code)
    };
  });
}

/**
 * JSON with one entry per block and the `kind`/`severity` arrays inline —
 * the shape prettier settles on, so `pnpm format` does not reflow the file.
 */
export function serializeCatalog(catalog) {
  const entries = catalog.map(entry => {
    const fields = Object.entries(entry).map(
      ([key, value]) =>
        `    ${JSON.stringify(key)}: ${
          Array.isArray(value)
            ? `[${value.map(v => JSON.stringify(v)).join(", ")}]`
            : JSON.stringify(value)
        }`
    );
    return `  {\n${fields.join(",\n")}\n  }`;
  });
  return `[\n${entries.join(",\n")}\n]\n`;
}

function main(argv) {
  const root = repoRoot();
  const check = argv.includes("--check");
  const sources = readSources(root);
  const output = serializeCatalog(buildCatalog(sources));
  const target = join(root, OUTPUT_JSON);
  for (const code of sources.skill.keys()) {
    if (!sources.dev.codes.includes(code))
      console.warn(`warning: ${SKILL_MD} has a section \`${code}\` that is not a DiagnosticCode`);
  }
  if (check) {
    let current = null;
    try {
      current = readFileSync(target, "utf8");
    } catch {}
    if (current !== output) {
      console.error(`${OUTPUT_JSON} is stale; run \`pnpm diagnostics:json\``);
      process.exit(1);
    }
    console.log(`${OUTPUT_JSON} is up to date`);
    return;
  }
  writeFileSync(target, output);
  console.log(`wrote ${OUTPUT_JSON} (${sources.dev.codes.length} codes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
