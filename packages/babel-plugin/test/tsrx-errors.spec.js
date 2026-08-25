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
