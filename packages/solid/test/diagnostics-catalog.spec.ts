/**
 * The diagnostic catalog is kept by hand in three places — the
 * `DiagnosticCode` union (`@solidjs/signals`), the RFC's quick-reference
 * table, and the `reactivity-diagnostics` skill's per-code sections — and
 * `packages/solid/diagnostics.json` is generated from them
 * (`pnpm diagnostics:json`). These tests fail, naming the exact differences,
 * when the sources disagree on the set of codes or the committed file is
 * stale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_TS,
  OUTPUT_JSON,
  RFC_MD,
  SKILL_MD,
  buildCatalog,
  readSources,
  repoRoot,
  serializeCatalog
} from "../../../scripts/generate-diagnostics-json.mjs";

/**
 * Skill sections that are not `DiagnosticCode`s. `FLUSH_IN_ACTION` is the
 * bracketed code of an error the dev scheduler THROWS (`flush()` inside an
 * action body); it is not emitted on the diagnostics channel, so it is not in
 * the union, the RFC table, or `diagnostics.json`, but the skill documents it
 * next to the codes. Promote it to a `DiagnosticCode` or move the section —
 * either is a maintainer's call; until then it is listed here, not ignored.
 */
const SKILL_ONLY_SECTIONS = new Set(["FLUSH_IN_ACTION"]);

const root = repoRoot();
const sources = readSources(root);
const committed = JSON.parse(readFileSync(join(root, OUTPUT_JSON), "utf8")) as { code: string }[];

/** Lines describing how `actual` differs from `expected`, or none. */
function setDifference(
  label: string,
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string>
): string[] {
  const missing = [...expected].filter(code => !actual.has(code)).sort();
  const extra = [...actual].filter(code => !expected.has(code)).sort();
  const lines: string[] = [];
  if (missing.length) lines.push(`${label} is missing: ${missing.join(", ")}`);
  if (extra.length) lines.push(`${label} has codes not in ${DEV_TS}: ${extra.join(", ")}`);
  return lines;
}

describe("diagnostic catalog", () => {
  test(`the DiagnosticCode union, ${RFC_MD}, ${SKILL_MD} and ${OUTPUT_JSON} name the same codes`, () => {
    const union = new Set(sources.dev.codes);
    const skillCodes = new Set(
      [...sources.skill.keys()].filter(code => !SKILL_ONLY_SECTIONS.has(code))
    );
    const differences = [
      ...setDifference(`${RFC_MD} (quick-reference table)`, union, new Set(sources.rfc.keys())),
      ...setDifference(`${SKILL_MD} (### sections)`, union, skillCodes),
      ...setDifference(OUTPUT_JSON, union, new Set(committed.map(entry => entry.code)))
    ];
    // A section listed as skill-only that has since become a code is a stale allowlist entry.
    for (const code of SKILL_ONLY_SECTIONS) {
      if (union.has(code))
        differences.push(`${code} is a DiagnosticCode now; drop it from SKILL_ONLY_SECTIONS`);
      if (!sources.skill.has(code))
        differences.push(`${code} has no skill section; drop it from SKILL_ONLY_SECTIONS`);
    }
    expect(differences, differences.join("\n")).toEqual([]);
  });

  test("every code has a repair sentence from the skill", () => {
    const withoutRepair = buildCatalog(sources)
      .filter(entry => entry.repair === null)
      .map(entry => entry.code);
    expect(withoutRepair, `no skill section for: ${withoutRepair.join(", ")}`).toEqual([]);
  });

  test(`${OUTPUT_JSON} is what the generator produces (run \`pnpm diagnostics:json\`)`, () => {
    const expected = serializeCatalog(buildCatalog(sources));
    const actual = readFileSync(join(root, OUTPUT_JSON), "utf8");
    if (actual === expected) return;
    const expectedByCode = new Map<string, unknown>(
      (JSON.parse(expected) as { code: string }[]).map(e => [e.code, e])
    );
    const actualByCode = new Map<string, unknown>(committed.map(e => [e.code, e]));
    const stale: string[] = [];
    for (const code of new Set([...expectedByCode.keys(), ...actualByCode.keys()])) {
      const want = JSON.stringify(expectedByCode.get(code));
      const have = JSON.stringify(actualByCode.get(code));
      if (want !== have) stale.push(`${code}:\n  committed: ${have}\n  generated: ${want}`);
    }
    expect.fail(
      `${OUTPUT_JSON} is stale; run \`pnpm diagnostics:json\`.\n${
        stale.length ? stale.join("\n") : "(entries equal; serialization differs)"
      }`
    );
  });
});
