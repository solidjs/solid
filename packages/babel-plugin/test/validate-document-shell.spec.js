/**
 * `validate` and document shells (#3259).
 *
 * The validator round-trips each template through a body-context fragment
 * parse — a context in which `<html>`/`<head>`/`<body>` wrappers are always
 * stripped, so a document-shell template could never pass no matter how
 * well-formed. Through rc.4 that printed a warning; once #3099 made validate
 * failures compile errors, a root-route component owning the document shell
 * (the ordinary Start shape) failed to compile in plain client mode — and
 * merely importing the module was fatal, which is how jsdom component-test
 * projects met it.
 *
 * Document shells now parse in the DOCUMENT context (the analogue of the
 * synthetic `<table>` for table partials) and only genuine restructuring —
 * markup a browser would actually rebuild — still errors.
 */
const babel = require("@babel/core");
const plugin = require("../index");

const clientCompile = src =>
  babel.transformSync(src, {
    plugins: [[plugin, { generate: "dom", hydratable: false }]],
    configFile: false,
    babelrc: false,
    filename: "root.jsx",
    highlightCode: false
  });

const malformedError = src => {
  try {
    clientCompile(src);
  } catch (error) {
    return error.message;
  }
  throw new Error("expected a malformed-markup error");
};

describe("validate accepts well-formed document shells (#3259)", () => {
  test("an <html> root document compiles in plain client mode", () => {
    const { code } = clientCompile(`
      export function Root(props) {
        return (
          <html>
            <head><title>App</title></head>
            <body><div id="app">{props.children}</div></body>
          </html>
        );
      }
    `);
    expect(code).toContain("_$template");
  });

  test("a <head> root compiles", () => {
    expect(
      clientCompile(`const view = <head><title>App</title><meta charset="utf-8" /></head>;`).code
    ).toContain("_$template");
  });

  test("a <body> root compiles", () => {
    expect(clientCompile(`const view = <body><div>App</div></body>;`).code).toContain("_$template");
  });

  test("a shell the browser restructures still fails: missing <head>", () => {
    expect(() => clientCompile(`const view = <html><body><div>App</div></body></html>;`)).toThrow(
      /malformed/
    );
  });

  test("a shell the browser restructures still fails: flow content in <head>", () => {
    expect(() =>
      clientCompile(`const view = <html><head><div>oops</div></head><body>App</body></html>;`)
    ).toThrow(/malformed/);
  });

  test("a shell the browser restructures still fails: <p> split in <body>", () => {
    expect(() =>
      clientCompile(
        `const view = <html><head><title>App</title></head><body><p>a<div>b</div></p></body></html>;`
      )
    ).toThrow(/malformed/);
  });

  test("ordinary malformed markup outside a shell still fails", () => {
    expect(() => clientCompile(`const view = <p>a<div>b</div></p>;`)).toThrow(/malformed/);
  });
});

describe("validate errors frame the offending JSX (#3099)", () => {
  test("a template returned from a multiline component", () => {
    const message = malformedError(`export function App() {
  return (
    <p><div>bad</div></p>
  );
}`);
    expect(message).toContain("> 3 |     <p><div>bad</div></p>");
    expect(message).not.toContain("internal node");
  });

  test("a template in a variable initializer", () => {
    const message = malformedError(`const ok = 1;
const view = <p><div>bad</div></p>;`);
    expect(message).toContain("> 2 | const view = <p><div>bad</div></p>;");
    expect(message).not.toContain("internal node");
  });
});
