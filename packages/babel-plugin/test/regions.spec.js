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

  it("emits the ENVELOPE contract: source-ordered compute, compare-and-write commit", () => {
    const out = compile(ROW, { regions: true });
    expect(out).toContain('import { region as _$region } from "@solidjs/web"');
    expect(out).toContain("_$region(row,");
    // COMPUTE: every expression evaluates into the envelope, source order —
    // eligible reads on `_u$`, the safe residual's depth-1 read rewritten.
    expect(out).toContain("(_t$, _u$, _d$) =>");
    expect(out).toContain("_t$.e = _u$.selected");
    expect(out).toContain("_t$.t = _u$.label");
    expect(out).toMatch(/_t\$\.a = selection\[_u\$\.id\]/);
    // COMMIT: compares + writes only, force flag, write-then-advance.
    expect(out).toContain("(_t$, _p$, _f$) =>");
    expect(out).toMatch(/_f\$ \|\| _v\$0 !== _p\$\.e/);
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
    // the parent chain to bump it (region()/bumpDeep).
    expect(out).toMatch(/,\s*1\s*\);/);
    // Deep steps resolve through the pending-aware helper; the leaf reads
    // off the prefix local.
    expect(out).toContain('const _w$0 = _d$(_u$, "lastSample")');
    expect(out).toContain('const _w$1 = _d$(_w$0, "topFiveQueries")');
    expect(out).toMatch(/_w\$2\.elapsed/);
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
