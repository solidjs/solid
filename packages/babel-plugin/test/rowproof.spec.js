/**
 * Compile-time row proofs (DESIGN-PATCH-CHANNEL §3c): strict positive AND
 * negative admission tests. The stamp (`rowProof`) is the patch-mode list
 * tier's ONLY admission mechanism — there is no runtime probe — so every
 * disqualifier here is load-bearing: a shape that wrongly stamps would bind
 * rows with no per-row owner and leak whatever the shape creates.
 */
const babel = require("@babel/core");
const plugin = require("../index");

function compile(src) {
  return babel.transformSync(src, {
    // patchDriver is DORMANT by default (extraction ruling) — this suite
    // tests the feature itself, so it opts in explicitly.
    plugins: [[plugin, { moduleName: "r-dom", generate: "dom", patchDriver: "patchDriver" }]],
    configFile: false,
    babelrc: false,
    filename: "row.jsx"
  }).code;
}

// Number of rowProof-wrapped functions in the output.
function stamps(code) {
  return (code.match(/_\$rowProof\(/g) || []).length;
}

describe("row-proof admission", () => {
  test("stamps a plain member-read row", () => {
    const code = compile(`const row = r => <li textContent={r.name} />;`);
    expect(stamps(code)).toBe(1);
  });

  test("stamps ternary/binary bindings (Tier-2 compiles into the body)", () => {
    const code = compile(
      `const row = r => <tr class={r.selected ? "danger" : ""}><td textContent={r.count + 1} /></tr>;`
    );
    expect(stamps(code)).toBe(1);
    expect(code).toContain("_$patchDriver");
  });

  test("stamps rows with event handlers (values evaluate once; not reactive)", () => {
    const code = compile(
      `const row = r => <li onClick={() => pick(r.id)} textContent={r.name} />;`
    );
    expect(stamps(code)).toBe(1);
  });

  test("stamps a static row (no dynamics at all)", () => {
    const code = compile(`const row = r => <li class="static">fixed</li>;`);
    expect(stamps(code)).toBe(1);
  });

  test("stamps a block-bodied row whose only statement is the return", () => {
    const code = compile(`const row = r => { return <li textContent={r.name} />; };`);
    expect(stamps(code)).toBe(1);
  });

  test("does NOT stamp rows with refs", () => {
    const code = compile(`const row = r => <li ref={r.el} textContent={r.name} />;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp rows with dynamic children (insert holes)", () => {
    const code = compile(`const row = r => <li>{r.name}</li>;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp rows containing components", () => {
    const code = compile(`const row = r => <li><Chip label={r.name} /></li>;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp rows with spreads", () => {
    const code = compile(`const row = r => <li {...r.attrs} textContent={r.name} />;`);
    expect(stamps(code)).toBe(0);
  });

  // NOTE: no `use:` directive test — 2.0 removed the construct (directive
  // work rides the `ref` property, denied above); `use:x` in source is just
  // an attribute name, and attribute writes are pure.

  test("does NOT stamp foreign-subject rows (patches must register on the row param)", () => {
    // Bindings root at an OUTER store: a pure template, but its patch would
    // register once per created row on a long-lived record with no per-row
    // disposal — the leak the runtime probe never caught.
    const code = compile(`const row = r => <li textContent={outer.title} />;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp mixed-subject rows (row + outer reads)", () => {
    const code = compile(`const row = r => <li class={sel.id === r.id ? "on" : ""} />;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp multi-param or destructured-param functions", () => {
    expect(stamps(compile(`const row = (r, i) => <li textContent={r.name} />;`))).toBe(0);
    expect(stamps(compile(`const row = ({ name }) => <li textContent={name} />;`))).toBe(0);
  });

  test("does NOT stamp rows with call-valued bindings (calls are not eligible expressions)", () => {
    const code = compile(`const row = r => <li textContent={r.name.toUpperCase()} />;`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp block bodies with statements beyond the return", () => {
    const code = compile(`const row = r => { doWork(r); return <li textContent={r.name} />; };`);
    expect(stamps(code)).toBe(0);
  });

  test("does NOT stamp fragment-rooted rows", () => {
    const code = compile(`const row = r => <><li textContent={r.name} /></>;`);
    expect(stamps(code)).toBe(0);
  });
});
