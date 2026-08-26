const babel = require("@babel/core");
const plugin = require("../index");

const pluginOptions = {
  moduleName: "r-dom",
  builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
  generate: "dom"
};

async function compile(code, { filename = "case.tsrx", syntax } = {}) {
  const result = await babel.transformAsync(code, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, syntax ? { ...pluginOptions, syntax } : pluginOptions]],
    filename
  });
  return result.code;
}

describe("TSRX diagnostics", () => {
  test("scoped style blocks are rejected with a structured diagnostic", async () => {
    await expect(
      compile(`export function C() @{
  <div>
    <style>
      div { color: red; }
    </style>
    <p>hi</p>
  </div>
}`)
    ).rejects.toThrow(/scoped <style> blocks are not yet supported/i);
  });

  test("return inside an @if branch is rejected", async () => {
    await expect(
      compile(`export function C({ ok }) @{
  <div>
    @if (ok) {
      return <p>no</p>;
    }
  </div>
}`)
    ).rejects.toThrow(/return/i);
  });

  test("@for over for-in is rejected", async () => {
    await expect(
      compile(`export function C({ obj }) @{
  <ul>
    @for (const key in obj) {
      <li>{key}</li>
    }
  </ul>
}`)
    ).rejects.toThrow();
  });

  test.each([
    {
      name: "return escaping an @for body",
      source:
        "export function C({ xs }) @{ <ul>@for (const x of xs) { return <li>{x}</li>; }</ul> }",
      message: /Return statements are not allowed/
    },
    {
      name: "continue escaping an @for body",
      source:
        "export function C({ xs }) @{ <ul>@for (const x of xs) { continue; <li>{x}</li> }</ul> }",
      message: /Continue statements are not allowed/
    },
    {
      name: "break escaping an @switch case",
      source: "export const C = ({ x }) => @switch (x) { @case 1: { break; <p /> } };",
      message: /break.*invalid/i
    },
    {
      name: "for-await inside a template",
      source: "export function C({ xs }) @{ <ul>@for await (const x of xs) { <li>{x}</li> }</ul> }",
      message: /Unexpected token/
    },
    {
      name: "keyed @for with a destructured binding",
      source:
        "export function C({ xs }) @{ <ul>@for (const { id } of xs; key id) { <li>{id}</li> }</ul> }",
      message: /Combining `key` with a destructured @for binding/
    },
    {
      name: "a statement after rendered output",
      source: "export function C() @{ <p />; const x = 1; }",
      message: /statements cannot follow the rendered output/
    },
    {
      name: "multiple rendered output nodes",
      source: "export function C() @{ <p />; <span /> }",
      message: /renders a single node/
    },
    {
      name: "a destructured @catch binding",
      source: "export const C = () => @try { <p /> } @catch ({ message }) { <p>{message}</p> };",
      message: /error binding must be an identifier/
    },
    {
      name: "an @finally clause",
      source: "export const C = () => @try { <p /> } @finally { <p /> };",
      message: /Missing `@catch` or `@pending`/
    },
    {
      name: "whitespace between @ and a statement container",
      source: "export function C() @ { <p /> }",
      message: /Unexpected token/
    },
    {
      name: "whitespace between & and a lazy pattern",
      source: "export function C({ x }) @{ const & { value } = x; <p>{value}</p> }",
      message: /Unexpected token/
    }
  ])("rejects $name", async ({ source, message }) => {
    await expect(compile(source)).rejects.toThrow(message);
  });

  test("statement container without an output node is rejected", async () => {
    await expect(
      compile(`export function C() @{
  const x = 1;
}`)
    ).rejects.toThrow();
  });

  test("syntax: 'jsx' disables TSRX routing even for .tsrx filenames", async () => {
    await expect(
      compile(
        `export function C() @{
  <p>hi</p>
}`,
        { syntax: "jsx" }
      )
    ).rejects.toThrow();
  });

  test("syntax: 'tsrx' forces TSRX parsing for non-.tsrx filenames", async () => {
    const code = await compile(
      `export const C = ({ on }) => @if (on) {
  <p>yes</p>
};`,
      { filename: "case.tsx", syntax: "tsrx" }
    );
    expect(code).toContain("Show");
  });

  test("plain JSX files are untouched by the TSRX frontend", async () => {
    const code = await compile(`export const C = () => <p title="&amp;">hi</p>;`, {
      filename: "case.jsx"
    });
    expect(code).toContain("_$template");
  });
});
