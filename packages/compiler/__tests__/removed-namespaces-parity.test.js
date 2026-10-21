// Parity for the removed Solid 1.x attribute forms (#4187): `on:`,
// `oncapture:`, `attr:`, `bool:`, `use:` and `classList` on native elements
// are compile errors in the web generates (dom / ssr, including dynamic
// mode's dom elements), and both compilers must raise the same message at the
// same line. Supported namespaces, components and universal output compile.
//
// The compilers format locations differently (Babel prefixes the filename
// and appends a code frame; Oxc appends `(line:column)`), so the message text
// is compared exactly and the location by line.

const { modes, compileBabel, compileOxc } = require("./parity/harness");

const errorCases = {
  "on:": "const v = <button on:click={() => {}} />;",
  "oncapture:": "const v = <div oncapture:click={f} />;",
  "attr:": 'const v = <div attr:foo="x" />;',
  "bool:": "const v = <div bool:hidden={true} />;",
  "use: without value": "const v = <input\n  use:autofocus\n/>;",
  "use: with value": "const v = <button use:tooltip={{ content: 'Save' }} />;",
  classList: 'const v = <div class="card" classList={{ active: a() }} />;',
  "nested static child": "const v = <div>\n  <ul><li use:tip /></ul>\n</div>;",
  "nested dynamic child": "const v = <div>{x()}<span bool:hidden={h()}>{y()}</span></div>;",
  "beside a spread": "const v = <div {...props} on:click={f} />;",
  "custom element": "const v = <my-el attr:plain={p()} />;",
  "svg child": "const v = <svg><rect use:tip /></svg>;",
  "native child of a component": "const v = <Comp><div classList={c()} /></Comp>;",
  "first offender wins": 'const v = <div attr:a="1"><b use:b /></div>;'
};

const acceptedCases = {
  "prop:": "const v = <input prop:value={v()} />;",
  "xlink: and xmlns:":
    'const v = <svg xmlns:xlink="http://www.w3.org/1999/xlink"><path xlink:href="#a" /></svg>;',
  "xml:": 'const v = <div xml:lang="en" />;',
  "2.0 forms": "const v = <div class={{ active: a() }} onClick={f} ref={r} />;",
  "lowercase attributes": 'const v = <div classlist="x" onclick="go()" />;',
  "component props": 'const v = <Comp on:click={f} use:tip={t} attr:x="1" bool:y classList={c} />;'
};

const webModes = Object.keys(modes).filter(
  mode => !mode.startsWith("tsrx") && !mode.includes("universal")
);
const universalModes = ["universal"];

function attempt(compile) {
  try {
    compile();
    return null;
  } catch (error) {
    return error;
  }
}

function babelDiagnostic(error) {
  const [first] = error.message.split("\n");
  const frame = error.message.match(/^>\s*(\d+) \|/m);
  return { message: first.replace(/^[^:]*\.jsx: /, ""), line: frame && Number(frame[1]) };
}

function oxcDiagnostic(error) {
  const match = error.message.match(/^(.*) \((\d+):(\d+)\)$/s);
  expect(match).not.toBeNull();
  return { message: match[1], line: Number(match[2]) };
}

describe("removed 1.x attribute forms: Babel vs Oxc", () => {
  for (const mode of webModes) {
    describe(mode, () => {
      const options = modes[mode].options;
      test.each(Object.keys(errorCases))("errors: %s", name => {
        const code = errorCases[name];
        const babelError = attempt(() => compileBabel(code, options, "removed.jsx"));
        const oxcError = attempt(() => compileOxc(code, "removed", options));
        expect(babelError).not.toBeNull();
        expect(oxcError).not.toBeNull();
        const babel = babelDiagnostic(babelError);
        const oxc = oxcDiagnostic(oxcError);
        expect(babel.message).toMatch(/removed in Solid 2\.0/);
        expect(oxc).toEqual(babel);
      });
      test.each(Object.keys(acceptedCases))("accepts: %s", name => {
        const code = acceptedCases[name];
        expect(attempt(() => compileBabel(code, options, "removed.jsx"))).toBeNull();
        expect(attempt(() => compileOxc(code, "removed", options))).toBeNull();
      });
    });
  }

  for (const mode of universalModes) {
    test(`${mode} leaves attribute names to the renderer`, () => {
      const options = modes[mode].options;
      for (const code of Object.values(errorCases)) {
        expect(attempt(() => compileBabel(code, options, "removed.jsx"))).toBeNull();
        expect(attempt(() => compileOxc(code, "removed", options))).toBeNull();
      }
    });
  }
});
