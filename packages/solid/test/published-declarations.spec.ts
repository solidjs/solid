import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// A consumer compiling with `skipLibCheck: false` type-checks this package's
// generated declarations. `stripInternal` removes an `@internal` declaration
// but not a re-export of it from an untagged statement, so a name tagged at
// its declaration and re-exported from a public block leaves `index.d.ts`
// exporting nothing (TS2305) — invisible under `skipLibCheck`, where the name
// silently types as `any` (#3709: `sharedConfig`, `$DEVCOMP`). The same holds
// for a public declaration that names a stripped type. Compile a probe that
// imports every published types entry, resolved through the package's own
// `exports` as a consumer would, and require the declarations to check clean.
// Real path: the compiler reports resolved files by it.
const packageDir = realpathSync(resolve(import.meta.dirname, ".."));
const typesDir = resolve(packageDir, "types");
const ENTRIES: Record<string, string> = {
  "solid-js": "index.d.ts",
  "solid-js/internal": "internal.d.ts",
  "solid-js/refresh": "refresh/index.d.ts",
  "solid-js/attribution": "attribution.d.ts"
};

test("the published declarations type-check under skipLibCheck: false", () => {
  const probe = resolve(packageDir, "test/__declarations-probe__.ts");
  const source = Object.keys(ENTRIES)
    .map((specifier, i) => `import * as e${i} from "${specifier}";\nexport { e${i} };`)
    .join("\n");
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: []
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = file => file === probe || fileExists.call(host, file);
  host.readFile = file => (file === probe ? source : readFile.call(host, file));
  host.getSourceFile = (file, languageVersion, ...rest) =>
    file === probe
      ? ts.createSourceFile(file, source, languageVersion)
      : getSourceFile.call(host, file, languageVersion, ...rest);
  const program = ts.createProgram([probe], options, host);

  // Every entry must resolve to this package's generated declarations, or
  // the check below would pass over files it never saw.
  const resolved = Object.values(ENTRIES).filter(file =>
    program.getSourceFile(resolve(typesDir, file))
  );
  expect(resolved).toEqual(Object.values(ENTRIES));

  const ours = program
    .getSourceFiles()
    .filter(sf => sf.fileName === probe || resolve(sf.fileName).startsWith(typesDir + "/"));
  const diagnostics = ours.flatMap(sf => [
    ...program.getSyntacticDiagnostics(sf),
    ...program.getSemanticDiagnostics(sf)
  ]);
  const report = diagnostics.map(d => {
    const where = d.file
      ? `${d.file.fileName.slice(packageDir.length + 1)}:${
          d.file.getLineAndCharacterOfPosition(d.start!).line + 1
        }`
      : "(global)";
    return `${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  expect(report).toEqual([]);
});
