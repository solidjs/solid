const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const plugin = require("../index");

const coveragePragmasFixture = fs.readFileSync(
  path.join(__dirname, "__shared_fixtures__", "coveragePragmas", "code.js"),
  "utf8"
);

function compile(code, generate = "ssr", hydratable = true) {
  return babel.transformSync(code, {
    plugins: [[plugin, { generate, hydratable }]],
    configFile: false,
    babelrc: false,
    filename: "input.jsx"
  }).code;
}

describe("intrinsic ref and spread sources", () => {
  test.each(["istanbul", "c8"])(
    "preserves a %s ignore comment for a generated children getter",
    tool => {
      const output = compile(coveragePragmasFixture, "dom");
      expect(output).toMatch(new RegExp(`/\\* ${tool} ignore next \\*/\\s*get children\\(\\)`));
    }
  );

  test.each([
    ["a spread", "const view = <div {...attrs()} />;"],
    [
      "an assignment ref before a spread",
      "let node; const view = <div ref={node} {...attrs()} />;"
    ],
    ["an assignment ref after a spread", "let node; const view = <div {...attrs()} ref={node} />;"],
    [
      "a callback ref and children",
      "let node; const view = <div ref={el => (node = el)} {...attrs()}>child</div>;"
    ],
    ["a directive ref", "const view = <div ref={directive(source)} {...attrs()} />;"],
    [
      "a static spread marker",
      "let node; const view = <div ref={node} {/* @static */ ...attrs()} />;"
    ]
  ])("passes one effective source through for %s", (_, source) => {
    for (const hydratable of [true, false]) {
      const output = compile(source, "ssr", hydratable);
      expect(output).toContain('ssrElement("div", attrs()');
      expect(output).not.toContain("mergeProps");
    }
  });

  test("passes a static object source through with a ref", () => {
    const output = compile(
      'let node; const attrs = { class: "example" }; const view = <div ref={node} {...attrs} />;'
    );
    expect(output).toContain('ssrElement("div", attrs,');
    expect(output).not.toContain("mergeProps");
  });

  test.each([
    ["an ordinary attribute", 'const view = <div id="x" {...attrs()} />;'],
    [
      "a ref and an ordinary attribute",
      'let node; const view = <div ref={node} id="x" {...attrs()} />;'
    ],
    ["two spreads", "const view = <div {...a()} {...b()} />;"],
    ["an event", "let node; const view = <div ref={node} onClick={click} {...attrs()} />;"],
    [
      "a property",
      "let node; const view = <input ref={node} prop:value={value()} {...attrs()} />;"
    ],
    [
      "an explicit children source",
      "let node; const view = <div ref={node} children={fallback()} {...attrs()}>child</div>;"
    ],
    [
      "several attributes and spreads",
      'let node; const view = <div ref={node} id="x" {...a()} title="y" {...b()} />;'
    ]
  ])("keeps mergeProps for %s", (_, source) => {
    expect(compile(source)).toContain("mergeProps");
    expect(compile(source, "dom")).toContain("mergeProps");
  });

  test("does not change component ref props", () => {
    const output = compile("let node; const view = <Comp ref={node} {...attrs()} />;");
    expect(output).toContain("Comp(");
    expect(output).toContain("mergeProps");
  });

  test("keeps the client direct-source rule", () => {
    const output = compile("let node; const view = <div ref={node} {...attrs()} />;", "dom");
    expect(output).toMatch(/spread\([^,]+, attrs, false\)/);
    expect(output).not.toContain("mergeProps");
  });
});
