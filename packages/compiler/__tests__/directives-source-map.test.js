const { createRequire } = require("module");
const { transformDirectives } = require("..");
// Use the tracing dependency already supplied by the Babel parity harness.
const babelRequire = createRequire(require.resolve("@babel/core"));
const { TraceMap, originalPositionFor } = babelRequire("@jridgewell/trace-mapping");
const filename = "/project/src/App.js";

function position(source, marker) {
  const offset = source.indexOf(marker);
  expect(offset).toBeGreaterThanOrEqual(0);
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length, column: lines.at(-1).length };
}

function check(source, mode, markers, extra = {}) {
  const options = { filename, root: "/project", mode, ...extra };
  const result = transformDirectives(source, { ...options, sourceMap: true });
  const map = new TraceMap(result.map);
  expect(map.sources).toEqual([filename]);
  expect(map.sourcesContent).toEqual([source]);
  const withoutMap = transformDirectives(source, { ...options, sourceMap: false });
  expect(result.code).toBe(withoutMap.code);
  expect(result.functions).toEqual(withoutMap.functions);
  for (const marker of markers) {
    const original = originalPositionFor(map, position(result.code, marker));
    expect(original).toMatchObject({ source: filename, ...position(source, marker) });
  }
  return result;
}

const markers = ["css`", "kept", "tone"];
const component = `export const kept = css\`color: \${tone};\n  background: white;\`;
export const footer = "😀"; export const keptSecond = css\`border: 0\`;
`;

describe('"use server" source maps', () => {
  for (const mode of ["client", "server"]) {
    it(`${mode}: preserves the input map when DCE has no candidates`, () => {
      check(
        `export async function load() { "use server"; return "ready"; }
const tone = "blue";
${component}`,
        mode,
        [...markers, "keptSecond"]
      );
    });

    it(`${mode}: traces through multiple cascading DCE passes`, () => {
      const result = check(
        `import { secret } from "./server-only";
const first = secret;
const secondOnly = first;
const third = secondOnly;
const tone = "blue";
export async function load() { "use server"; return third; }
${component}`,
        mode,
        [...markers, "keptSecond"]
      );
      expect(result.code.includes("server-only")).toBe(mode === "server");
      expect(result.code.includes("secondOnly")).toBe(mode === "server");
    });

    it(`${mode}: preserves mappings when direct eval prevents DCE`, () => {
      check(
        `import { secret } from "./server-only";
const tone = "blue";
eval("secret");
export async function load() { "use server"; return secret; }
${component}`,
        mode,
        markers
      );
    });

    it(`${mode}: preserves mappings for async generator expressions`, () => {
      check(
        `const tone = "blue";
export const stream = liveQuery(async function* () {
  "use server";
  yield "ready";
});
${component}`,
        mode,
        markers
      );
    });

    it(`${mode}: preserves maps when there is no directive`, () => {
      const source = `const tone = "blue";\n${component}`;
      expect(check(source, mode, markers).valid).toBe(false);
    });
  }
});
