// API-surface tests for transformRefresh: option validation, the async
// variant, sourcemaps, and the configurable runtime import source.
//
// The import source defaults to "solid-refresh" (byte-for-byte what the
// Babel plugin emits — the frozen parity fixtures depend on that), but the
// vite-plugin-solid integration will point it at the dev-only
// `solid-js/refresh` entry that carries the same frozen runtime ABI
// ($$registry / $$component / $$refresh / $$decline, same hot.data
// protocol), so overriding it is a first-class, tested path.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformRefresh, transformRefreshAsync } = require(compilerDir);
const { fixtureNames, readFixture, fixtureId, compileOxc } = require("./refresh/harness");

const CODE = `export const App = () => <div />;\n`;
const OPTIONS = { filename: "src/app.jsx", bundler: "vite", fixRender: true, jsx: false };

describe("transformRefresh options", () => {
  it("requires source code as a string", () => {
    expect(() => transformRefresh(42)).toThrow(/expects source code as a string/);
  });

  it("rejects unknown options", () => {
    expect(() => transformRefresh(CODE, { ...OPTIONS, hot: true })).toThrow(/unknown option `hot`/);
  });

  it("rejects unsupported bundlers", () => {
    expect(() => transformRefresh(CODE, { ...OPTIONS, bundler: "webpack" })).toThrow(
      /`bundler` option must be "esm", "vite", "webpack5", "rspack-esm" or "standard"/
    );
  });

  it("rejects the unported JSX-granularity mode", () => {
    expect(() => transformRefresh(CODE, { ...OPTIONS, jsx: true })).toThrow(
      /does not support `jsx: true`/
    );
  });

  it("rejects wrongly typed options", () => {
    expect(() => transformRefresh(CODE, { ...OPTIONS, granular: "on" })).toThrow(
      /`granular` option must be boolean/
    );
    expect(() => transformRefresh(CODE, { ...OPTIONS, importSource: 5 })).toThrow(
      /`importSource` option must be a string/
    );
  });

  it("transformRefreshAsync matches the sync output", async () => {
    const sync = transformRefresh(CODE, OPTIONS);
    const async = await transformRefreshAsync(CODE, OPTIONS);
    expect(async).toEqual(sync);
  });

  it("emits a sourcemap when requested", () => {
    const result = transformRefresh(CODE, { ...OPTIONS, sourceMap: true });
    const map = JSON.parse(result.map);
    expect(map.sources).toContain("src/app.jsx");
  });

  it("returns untouched files unchanged, without a sourcemap", () => {
    const untouched = "export const a = 1;\n";
    const result = transformRefresh(untouched, { ...OPTIONS, sourceMap: true });
    expect(result.code).toBe(untouched);
    expect(result.map).toBeNull();
  });
});

describe("transformRefresh importSource", () => {
  it("defaults to solid-refresh", () => {
    const code = transformRefresh(CODE, OPTIONS).code;
    expect(code).toContain('from "solid-refresh"');
    expect(code).not.toContain("solid-js/refresh");
  });

  it("overriding to solid-js/refresh only rewrites the runtime imports", () => {
    for (const fixture of fixtureNames()) {
      const base = compileOxc(fixture).code;
      const overridden = compileOxc(fixture, { importSource: "solid-js/refresh" }).code;
      // Same frozen ABI, so the output must be identical except for the
      // module specifier on the runtime imports.
      expect(overridden).toBe(base.replaceAll('from "solid-refresh"', 'from "solid-js/refresh"'));
    }
  });

  it("keeps every runtime import on the override source", () => {
    const source = readFixture("function-component");
    const code = transformRefresh(source, {
      filename: fixtureId("function-component"),
      bundler: "vite",
      fixRender: true,
      jsx: false,
      importSource: "solid-js/refresh"
    }).code;
    expect(code).toContain('import { $$registry as _$$registry } from "solid-js/refresh"');
    expect(code).not.toContain('"solid-refresh"');
  });
});
