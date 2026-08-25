// API-surface tests for transformLazy: option validation, the async
// variant, no-op behavior and sourcemaps.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformLazy, transformLazyAsync } = require(compilerDir);

const CODE = `import { lazy } from 'solid-js';
const Home = lazy(() => import('./Home'));
export default Home;
`;

describe("transformLazy options", () => {
  it("requires source code as a string", () => {
    expect(() => transformLazy(null)).toThrow(/expects source code as a string/);
  });

  it("rejects unknown options", () => {
    expect(() => transformLazy(CODE, { filename: "a.jsx", roots: true })).toThrow(
      /unknown option `roots`/
    );
  });

  it("rejects wrongly typed options", () => {
    expect(() => transformLazy(CODE, { filename: 1 })).toThrow(
      /`filename` option must be a string/
    );
    expect(() => transformLazy(CODE, { filename: "a.jsx", sourceMap: "yes" })).toThrow(
      /`sourceMap` option must be boolean/
    );
  });

  it("is a no-op without a filename (mirrors the Babel plugin)", () => {
    expect(transformLazy(CODE).code).toBe(CODE);
    expect(transformLazy(CODE, {}).code).toBe(CODE);
  });

  it("transforms with a filename and appends the placeholder", () => {
    const result = transformLazy(CODE, { filename: "src/routes.jsx" });
    expect(result.code).toContain('"__SOLID_LAZY_MODULE__:./Home"');
    expect(result.map).toBeNull();
  });

  it("emits a sourcemap when requested", () => {
    const result = transformLazy(CODE, { filename: "src/routes.jsx", sourceMap: true });
    const map = JSON.parse(result.map);
    expect(map.sources).toContain("src/routes.jsx");
  });

  it("does not emit a sourcemap for untouched files", () => {
    const untouched = "export const a = 1;\n";
    const result = transformLazy(untouched, { filename: "src/a.js", sourceMap: true });
    expect(result.code).toBe(untouched);
    expect(result.map).toBeNull();
  });

  it("transformLazyAsync matches the sync output", async () => {
    const sync = transformLazy(CODE, { filename: "src/routes.jsx" });
    const async = await transformLazyAsync(CODE, { filename: "src/routes.jsx" });
    expect(async).toEqual(sync);
  });
});
