import { describe, expect, it } from "vitest";
import { transformSync } from "@babel/core";
import plugin from "../index.js";

const compile = (src, opts = {}) =>
  transformSync(src, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, { moduleName: "@solidjs/web", ...opts }]],
    parserOpts: { plugins: ["jsx"] }
  }).code;

describe("region emission (DESIGN-REGIONS.md)", () => {
  const ROW = `
function Row(row, selection) {
  return <tr class={row.selected ? "danger" : ""}>
    <td textContent={row.label} />
    <td data-sel={selection[row.id] ? "y" : "n"} />
  </tr>;
}`;

  it("emits one _$region with raw reads, a tracked residual, and scalar baselines", () => {
    const out = compile(ROW, { regions: true });
    expect(out).toContain('import { region as _$region } from "@solidjs/web"');
    expect(out).toContain("_$region(row,");
    // Eligible bindings substitute the subject with the commit-time raw.
    expect(out).toContain("_n$.selected");
    expect(out).toContain("_n$.label");
    // The dynamic-key read is a TRACKED residual in the compute; DIRECT
    // depth-1 subject reads inside it ride the raw parameter (_u$) — the
    // deep witness already wakes the compute on any subject change.
    expect(out).toMatch(/_t\$\.r0 = selection\[_u\$\.id\]/);
    expect(out).toContain("(_t$, _u$) =>");
    // No classic grouped effect emitted for this scope.
    expect(out).not.toContain("_$effect(");
  });

  it("is OFF by default — classic output byte-identical", () => {
    const out = compile(ROW);
    expect(out).not.toContain("_$region");
    expect(out).toContain("_$effect(");
  });

  it("declines scopes without a depth-1 subject (deep chains keep classic)", () => {
    const out = compile(`function Row(row) { return <td textContent={row.stats.count} />; }`, {
      regions: true
    });
    expect(out).not.toContain("_$region");
    expect(out).toContain("_$effect(");
  });

  it("declines reassignable subjects (fallback re-reads per run)", () => {
    const out = compile(
      `function f() { let row = first(); row = second(); return <td textContent={row.label} />; }`,
      { regions: true }
    );
    expect(out).not.toContain("_$region");
  });
});
