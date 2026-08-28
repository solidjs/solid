const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transform, transformDirectives } = require(compilerDir);

const ROOT = "/project";
const FILENAME = `${ROOT}/src/routes/App.tsrx`;
const EXPECTED_ID = "d353d140-0";

function transformServerFunctions(code, mode) {
  return transformDirectives(code, {
    filename: FILENAME,
    root: ROOT,
    mode,
    env: "production"
  });
}

describe('"use server" composition for .tsrx modules', () => {
  it.each(["server", "client"])(
    "transforms generated JavaScript using the original .tsrx path in %s mode",
    mode => {
      const generated = `
        export async function save(value) {
          "use server";
          return value;
        }
      `;

      const result = transformServerFunctions(generated, mode);

      expect(result.valid).toBe(true);
      expect(result.functions).toEqual([{ id: EXPECTED_ID, name: "save", exports: [] }]);
      expect(result.code).toContain(`"${EXPECTED_ID}"`);
    }
  );

  it("does not project raw TSRX in the standalone directive pass", () => {
    expect(() =>
      transformServerFunctions(
        `
          export function App() @{
            <button>Save</button>
          }
        `,
        "server"
      )
    ).toThrow();
  });

  it.each(["server", "client"])(
    "composes TSRX lowering with the directive pass in %s mode",
    mode => {
      const rawTsrx = `
        export async function save(name: string) {
          "use server";
          return \`Saved \${name}\`;
        }

        export function App(props: { name: string }) @{
          <button>{props.name}</button>
        }
      `;

      const lowered = transform(rawTsrx, {
        filename: FILENAME,
        generate: "dom"
      });
      const result = transformServerFunctions(lowered.code, mode);

      expect(lowered.code).not.toContain("@{");
      expect(result.valid).toBe(true);
      expect(result.functions).toEqual([{ id: EXPECTED_ID, name: "save", exports: [] }]);
      expect(result.code).toContain("function App");
    }
  );
});
