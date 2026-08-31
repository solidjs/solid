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

function createLanguageService(code) {
  const filename = path.join(__dirname, "__virtual-tsrx-editor.tsx");
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
  const host = {
    getCompilationSettings: () => options,
    getCurrentDirectory: () => repository,
    getDefaultLibFileName: compilerOptions => ts.getDefaultLibFilePath(compilerOptions),
    getScriptFileNames: () => [filename],
    getScriptSnapshot: name => {
      if (name === filename) return ts.ScriptSnapshot.fromString(code);
      const text = ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getScriptVersion: () => "0",
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile
  };
  return { filename, service: ts.createLanguageService(host) };
}

function mapGeneratedRange(output, start, length) {
  const mapping = output.mappings.find(
    candidate =>
      candidate.generatedStart <= start &&
      candidate.generatedStart + candidate.generatedLength >= start + length
  );
  if (!mapping) return null;
  return {
    start: mapping.sourceStart + start - mapping.generatedStart,
    length
  };
}

function expectEveryOccurrenceMapped(source, output, identifier, skip = 0) {
  const occurrences = [...source.matchAll(new RegExp(`\\b${identifier}\\b`, "g"))].slice(skip);
  expect(occurrences.length).toBeGreaterThan(0);
  for (const occurrence of occurrences) {
    const start = occurrence.index;
    const mapping = output.mappings.find(
      candidate =>
        candidate.sourceStart <= start &&
        candidate.sourceStart + candidate.sourceLength >= start + identifier.length
    );
    expect(mapping).toBeDefined();
    const generatedStart = mapping.generatedStart + start - mapping.sourceStart;
    expect(output.code.slice(generatedStart, generatedStart + identifier.length)).toBe(identifier);
  }
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
    expect(output.mappings.length).toBeGreaterThan(0);
    for (const mapping of output.mappings) {
      expect(source.slice(mapping.sourceStart, mapping.sourceStart + mapping.sourceLength)).toBe(
        output.code.slice(mapping.generatedStart, mapping.generatedStart + mapping.generatedLength)
      );
    }
    const card = source.indexOf("Card");
    const cardMapping = output.mappings.find(
      mapping =>
        mapping.sourceStart <= card &&
        mapping.sourceStart + mapping.sourceLength >= card + "Card".length
    );
    expect(cardMapping).toBeDefined();
    expect(
      output.mappings.some(mapping =>
        output.code
          .slice(mapping.generatedStart, mapping.generatedStart + mapping.generatedLength)
          .includes("__tsrx_")
      )
    ).toBe(false);
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
      expectEveryOccurrenceMapped(source, output, "rows");
      expectEveryOccurrenceMapped(source, output, "row");
      expectEveryOccurrenceMapped(source, output, "index", 1);
    }
  );

  test("supports diagnostics, completion, navigation, and rename through exact mappings", () => {
    const source = `type Row = { name: string };
export function Rows({ rows }: { rows: Row[] }) @{
  @for (const row of rows) {
    <p>{row.name}:{row.missing}</p>
  }
}`;
    const output = projectTsrxForTypecheck(source, { filename: "editor.tsrx" });
    const { filename, service } = createLanguageService(output.code);
    const generatedUse = output.code.indexOf("row.name");
    const generatedMissing = output.code.indexOf("missing");
    const generatedName = generatedUse + "row.".length;

    expect(
      service
        .getCompletionsAtPosition(filename, generatedUse + "row.".length, {})
        ?.entries.some(entry => entry.name === "name")
    ).toBe(true);
    expect(service.getQuickInfoAtPosition(filename, generatedName + 1)).toBeDefined();

    const definition = service.getDefinitionAtPosition(filename, generatedName + 1);
    expect(definition?.length).toBeGreaterThan(0);
    expect(
      definition?.some(entry =>
        mapGeneratedRange(output, entry.textSpan.start, entry.textSpan.length)
      )
    ).toBe(true);

    const rename = service.findRenameLocations(filename, generatedName + 1, false, false, true);
    expect(rename?.length).toBeGreaterThanOrEqual(2);
    expect(
      rename?.every(entry =>
        Boolean(mapGeneratedRange(output, entry.textSpan.start, entry.textSpan.length))
      )
    ).toBe(true);

    const missingDiagnostic = service
      .getSemanticDiagnostics(filename)
      .find(diagnostic => diagnostic.start === generatedMissing);
    expect(missingDiagnostic).toBeDefined();
    if (!missingDiagnostic) throw new Error("missing property diagnostic");
    expect(mapGeneratedRange(output, missingDiagnostic.start, missingDiagnostic.length)).toEqual({
      start: source.indexOf("missing"),
      length: "missing".length
    });
  });
});
