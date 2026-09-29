import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
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
const signalsDir = realpathSync(resolve(packageDir, "node_modules/@solidjs/signals"));
const TYPE_DIRS = [resolve(packageDir, "types"), resolve(signalsDir, "dist/types")];
const ENTRIES: Record<string, string> = {
  "solid-js": resolve(packageDir, "types/index.d.ts"),
  "solid-js/internal": resolve(packageDir, "types/internal.d.ts"),
  "solid-js/refresh": resolve(packageDir, "types/refresh/index.d.ts"),
  "solid-js/attribution": resolve(packageDir, "types/attribution.d.ts"),
  "@solidjs/signals": resolve(signalsDir, "dist/types/index.d.ts"),
  "@solidjs/signals/attribution": resolve(signalsDir, "dist/types/attribution.d.ts")
};

// The compiler runs in a child Node: V8 coverage instruments every script in
// the worker's isolate (`coverage.include` only filters the report), which
// multiplies the checker's cost several-fold under `vitest --coverage`.
const check = (lib: string[], extra = "") => `
import { relative, resolve } from "node:path";
import ts from "typescript";

const packageDir = ${JSON.stringify(packageDir)};
const packagesDir = resolve(packageDir, "..");
const typeDirs = ${JSON.stringify(TYPE_DIRS)};
const entries = ${JSON.stringify(ENTRIES)};
const probe = resolve(packageDir, "test/__declarations-probe__.ts");
const source =
  Object.keys(entries)
    .map((specifier, i) => \`import * as e\${i} from "\${specifier}";\\nexport { e\${i} };\`)
    .join("\\n") + ${JSON.stringify("\n" + extra)};
const options = {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ${JSON.stringify(lib)},
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

const resolved = Object.values(entries).filter(file => program.getSourceFile(file));
const ours = program
  .getSourceFiles()
  .filter(
    sf =>
      sf.fileName === probe || typeDirs.some(dir => resolve(sf.fileName).startsWith(dir + "/"))
  );
const report = ours
  .flatMap(sf => [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)])
  .map(d => {
    const where = d.file
      ? \`\${relative(packagesDir, d.file.fileName)}:\${
          d.file.getLineAndCharacterOfPosition(d.start).line + 1
        }\`
      : "(global)";
    return \`\${where} TS\${d.code}: \${ts.flattenDiagnosticMessageText(d.messageText, " ")}\`;
  });
process.stdout.write(JSON.stringify({ resolved, report }));
`;

function run(script: string) {
  const { resolved, report } = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: packageDir,
      encoding: "utf8"
    })
  );

  // Every entry must resolve to the generated declarations, or the check
  // would pass over files it never saw.
  expect(resolved).toEqual(Object.values(ENTRIES));
  expect(report).toEqual([]);
}

// The check is a few hundred milliseconds alone but several seconds when
// turbo runs every package's suite at once, past vitest's 5 s default.
test("the published declarations type-check under skipLibCheck: false", () => {
  // A signal the declarations accept must still be the DOM's own `AbortSignal`,
  // not a structural stand-in `fetch` would reject.
  run(
    check(
      ["lib.es2022.d.ts", "lib.dom.d.ts"],
      `import type { UntilOptions } from "solid-js";
declare const options: UntilOptions;
void fetch("/", { signal: options.signal });`
    )
  );
}, 30000);

// Nothing here is DOM- or Node-specific, so a server or worker consumer with
// neither the DOM lib nor `@types/node` must not trip over a platform global.
test("the published declarations type-check without the DOM lib or @types/node", () => {
  run(check(["lib.es2022.d.ts"]));
}, 30000);
