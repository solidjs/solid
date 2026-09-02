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

  it("deep chains pass the DEEP flag — writes bubble, no witness subscriptions (dbmon shape)", () => {
    const out = compile(
      `function Row(row) { return <tr>
        <td textContent={row.lastSample.nbQueries} />
        <td textContent={row.lastSample.topFiveQueries[0].elapsed} />
      </tr>; }`,
      { regions: true }
    );
    expect(out).toContain("_$region(row,");
    // Deep-region root: the runtime flags the record and deep writes walk
    // the parent chain to bump it (region()/bumpDeep). One dk read.
    expect(out).toMatch(/\}, 1\);/);
    // Body reads ride the commit-time raw all the way down.
    expect(out).toContain("_n$.lastSample.topFiveQueries[0].elapsed");
    expect(out).not.toContain("_$effect(");
  });

  it("depth-1 scopes omit the deep flag", () => {
    const out = compile(`function Row(row) { return <td textContent={row.label} />; }`, {
      regions: true
    });
    expect(out).toContain("_$region(row,");
    expect(out).not.toMatch(/\}, 1\);/);
  });

  it("dynamic-key steps disqualify the chain — scope stays classic", () => {
    const out = compile(
      `function Row(row, i) { return <td textContent={row.queries[i].elapsed} />; }`,
      { regions: true }
    );
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
