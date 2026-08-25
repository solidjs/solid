const { modes, compileBabel, compileOxc, normalize, unifiedDiff } = require("./parity/harness");

const nestedCases = {
  "nested native children attribute": `
const view = <div><span children={content()} /></div>;
`,
  "children before dynamic textContent": `
const view = <span children={content()} textContent={text()} />;
`,
  "dynamic textContent before children": `
const view = <span textContent={text()} children={content()} />;
`,
  "children before static textContent": `
const view = <span children={content()} textContent="done" />;
`,
  "nested dynamic textContent with source child": `
const view = <div><span textContent={text()}>{content()}</span></div>;
`,
  "nested autonomous custom element owner": `
const view = <div><my-element id={id()} /></div>;
`,
  "nested customized built-in owner": `
const view = <div><button is="my-button" id={id()} /></div>;
`,
  "nested slot owner": `
const view = <div><slot name={name()} /></div>;
`
};

const additionalCases = {
  ...nestedCases,
  "compile-time static stateful property": `
const muted = true;
const view = <video muted={muted} />;
`,
  "removed namespace syntax after spread": `
const view = <div {...props} class:active={active()} />;
`,
  "JSX in conditional for initializer": `
function build() {
  if (cond())
    for (
      let node = <div>{value()}</div>;
      keepGoing();
      step()
    ) {}
}
`,
  "constant conditional through binding": `
const title = true ? "x" : "y";
const view = <div title={title} />;
`,
  "reassigned string binding stays dynamic": `
let title = "x";
title = "y";
const view = <div title={title} />;
`,
  "reassigned boolean binding stays dynamic": `
let muted = true;
muted = false;
const view = <video muted={muted} />;
`
};

describe("reported Babel vs Oxc parity regressions", () => {
  const compare = (mode, name, source) => {
    const options = modes[mode].options;
    const babel = normalize(compileBabel(source, options));
    const oxc = normalize(compileOxc(source, `reported-${name}`, options));

    if (babel !== oxc) {
      throw new Error(
        `${mode}/${name} diverges (normalized diff below, babel = "-", oxc = "+").\n` +
          unifiedDiff(babel, oxc)
      );
    }
    return { babel, oxc };
  };

  test.each(Object.keys(additionalCases))("dom/%s", name => {
    compare("dom", name, additionalCases[name]);
  });

  for (const mode of [
    "dom-hydratable",
    "dom-hydratable-dev",
    "dom-no-inline-styles",
    "dom-wrapperless",
    "dynamic"
  ]) {
    test.each(Object.keys(nestedCases))(`${mode}/%s`, name => {
      compare(mode, name, nestedCases[name]);
    });
  }

  test("pins the winning semantics rather than equality alone", () => {
    const output = name => compare("dom", name, additionalCases[name]).babel;

    expect(output("children before dynamic textContent")).toContain("text()");
    expect(output("children before dynamic textContent")).not.toContain("content()");

    expect(output("dynamic textContent before children")).toContain("content");
    expect(output("dynamic textContent before children")).not.toContain("text()");

    expect(output("nested dynamic textContent with source child")).toContain("content");
    expect(output("nested dynamic textContent with source child")).not.toContain("text()");

    expect(output("compile-time static stateful property")).toContain("<video muted>");
    expect(output("compile-time static stateful property")).not.toContain(".muted =");

    expect(output("removed namespace syntax after spread")).toContain('"class:active"');
    expect(output("JSX in conditional for initializer")).toMatch(
      /if \(cond\(\)\) for \(let node = \(\(\) => \{/
    );
    expect(output("constant conditional through binding")).toContain("<div title=x>");

    expect(output("reassigned string binding stays dynamic")).toContain("setAttribute");
    expect(output("reassigned string binding stays dynamic")).not.toContain("<div title=x>");
    expect(output("reassigned boolean binding stays dynamic")).toContain(".muted = muted");
  });
});
