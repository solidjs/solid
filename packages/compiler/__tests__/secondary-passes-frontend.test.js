const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformDirectives, transformLazy, transformRefresh } = require(compilerDir);

// Another front end (ReactiveScript's `.rx`, through a bundler's frontends hook)
// lowers its own modules to Solid's output, then hands that ordinary
// JavaScript to the secondary passes under the module's own filename — the
// path server-function ids hash, as the bundler's manifest keys it.
const ROOT = "/project";
const FILENAME = `${ROOT}/src/routes/App.rx`;
const generated = `
  export async function save(value) {
    "use server";
    return value;
  }
`;

describe("secondary passes for another front end's modules", () => {
  it.each(["server", "client"])(
    "transforms the generated JavaScript under the original path in %s mode",
    mode => {
      const result = transformDirectives(generated, {
        filename: FILENAME,
        root: ROOT,
        mode,
        env: "production"
      });
      expect(result.valid).toBe(true);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("save");
    }
  );

  it("hashes the module's own path, not a borrowed extension", () => {
    const own = transformDirectives(generated, {
      filename: FILENAME,
      root: ROOT,
      mode: "server",
      env: "production"
    });
    const client = transformDirectives(generated, {
      filename: FILENAME,
      root: ROOT,
      mode: "client",
      env: "production"
    });
    const borrowed = transformDirectives(generated, {
      filename: `${FILENAME}.tsx`,
      root: ROOT,
      mode: "server",
      env: "production"
    });
    expect(client.functions[0].id).toBe(own.functions[0].id);
    expect(borrowed.functions[0].id).not.toBe(own.functions[0].id);
  });

  it("runs the lazy and refresh passes under that filename", () => {
    const lazy = transformLazy(
      `import { lazy } from "solid-js";\nexport const Page = lazy(() => import("./Page.rx"));\n`,
      { filename: FILENAME }
    );
    expect(lazy.code).toContain("lazy(");
    const refresh = transformRefresh(`export function App() { return null; }\n`, {
      filename: FILENAME,
      bundler: "vite",
      jsx: false
    });
    expect(typeof refresh.code).toBe("string");
  });
});
