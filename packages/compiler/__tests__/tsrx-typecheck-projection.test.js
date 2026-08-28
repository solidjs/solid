const path = require("path");
const ts = require("typescript");
const { projectTsrxForTypecheck } = require("..");

function typecheck(code) {
  const filename = path.join(__dirname, "__virtual-tsrx-projection.tsx");
  const repository = path.resolve(__dirname, "../../..");
  const options = {
    baseUrl: repository,
    jsx: ts.JsxEmit.Preserve,
    jsxImportSource: "@solidjs/web",
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: {
      "solid-js": ["packages/solid/src/index.ts"],
      "@solidjs/web": ["packages/web/src/index.ts"],
      "@solidjs/web/jsx-runtime": ["packages/web/jsx/jsx.d.ts"]
    },
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = name => name === filename || ts.sys.fileExists(name);
  host.readFile = name => (name === filename ? code : ts.sys.readFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filename
      ? ts.createSourceFile(name, code, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter(diagnostic => diagnostic.file?.fileName === filename)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("TSRX typecheck projection", () => {
  test("returns post-rewrite TSX, authored maps, styles, and UTF-16 embeds", () => {
    const css = ".card { color: red }";
    const script = '{"emoji":"🚀"}';
    const source = `const marker = "🚀";
export function Card({ rows }) @{
  <>
    <style>${css}</style>
    @for (const { name = "missing" } of rows; index index) {
      <p class="card">{name}:{index}</p>
    }
    @try { <Broken /> } @catch (error) { <p>{error.message}</p> }
    <script type="application/json">${script}</script>
  </>
}`;

    const output = projectTsrxForTypecheck(source, { filename: "card.tsrx" });

    expect(output.code).toContain("keyed={false}");
    expect(output.code).toMatch(/__lazy\d+\(\)\.name/);
    expect(output.code).toContain("error().message");
    expect(output.cssHash).toMatch(/^tsrx-/);
    expect(output.css).toContain(output.cssHash);
    expect(JSON.parse(output.map)).toMatchObject({
      sources: ["card.tsrx"],
      sourcesContent: [source]
    });
    expect(output.embeddedRegions).toEqual([
      {
        kind: "css",
        start: source.indexOf(css),
        end: source.indexOf(css) + css.length,
        content: css
      },
      {
        kind: "script",
        start: source.indexOf(script),
        end: source.indexOf(script) + script.length,
        content: script
      }
    ]);
    expect(Buffer.byteLength(source.slice(0, source.indexOf(css)))).toBeGreaterThan(
      source.indexOf(css)
    );
  });

  test(
    "emits collision-safe helper imports that TypeScript can check directly",
    { timeout: 15000 },
    () => {
      const source = `const __tsrx_For0 = "taken";
export function Rows({ rows }: { rows: { name: string }[] }) @{
  @for (const row of rows; index index) {
    <p>{row.name}:{index}</p>
  }
}`;
      const output = projectTsrxForTypecheck(source, { filename: "rows.tsrx" });

      expect(output.code).toContain("For as __tsrx_For1");
      expect(typecheck(output.code)).toEqual([]);
    }
  );
});
