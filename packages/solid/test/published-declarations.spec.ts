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
const webDir = realpathSync(resolve(packageDir, "../web"));
const TYPE_DIRS = [resolve(packageDir, "types"), resolve(signalsDir, "dist/types")];
const ENTRIES: Record<string, string> = {
  "solid-js": resolve(packageDir, "types/index.d.ts"),
  "solid-js/internal": resolve(packageDir, "types/internal.d.ts"),
  "solid-js/refresh": resolve(packageDir, "types/refresh/index.d.ts"),
  "solid-js/attribution": resolve(packageDir, "types/attribution.d.ts"),
  "@solidjs/signals": resolve(signalsDir, "dist/types/index.d.ts"),
  "@solidjs/signals/attribution": resolve(signalsDir, "dist/types/attribution.d.ts")
};
// `@solidjs/web` is not a dependency of this package: mapped onto its
// generated declarations, for the hydration API downstream libraries use in
// place of `sharedConfig`. Its declarations need the DOM lib.
const WEB_ENTRY = { "@solidjs/web": resolve(webDir, "types/index.d.ts") };

// The public hydration API, typed as the published declarations must type it.
const HYDRATION_API = `
import { isHydrating, isHydratable } from "solid-js";
const hydrating: boolean = isHydrating();
const hydratable: boolean = isHydratable();
void hydrating, hydratable;
`;
const WEB_HYDRATION_API = `
import { getHydrationWriter, takeHydrationValue } from "@solidjs/web";
import type { HydrationWriter, HydrationValue } from "@solidjs/web";
const writer: HydrationWriter | undefined = getHydrationWriter();
if (writer) {
  const async: boolean = writer.async;
  const written: boolean = writer.write("lib:key", Promise.resolve(1), { deferStream: true });
  void async, written;
  // @ts-expect-error — \`async\` is read-only
  writer.async = true;
}
const taken: HydrationValue<number> | undefined = takeHydrationValue<number>("lib:key");
if (taken?.status === "resolved") {
  const value: number = taken.value;
  void value;
} else if (taken?.status === "rejected") {
  const error: unknown = taken.error;
  void error;
} else if (taken) {
  const promise: Promise<number> = taken.promise;
  void promise;
}
`;

// The compiler runs in a child Node: V8 coverage instruments every script in
// the worker's isolate (`coverage.include` only filters the report), which
// multiplies the checker's cost several-fold under `vitest --coverage`.
const check = (
  lib: string[],
  extra = "",
  entries: Record<string, string> = ENTRIES,
  typeDirs: string[] = TYPE_DIRS
) => `
import { relative, resolve } from "node:path";
import ts from "typescript";

const packageDir = ${JSON.stringify(packageDir)};
const packagesDir = resolve(packageDir, "..");
const typeDirs = ${JSON.stringify(typeDirs)};
const entries = ${JSON.stringify(entries)};
const web = ${JSON.stringify(WEB_ENTRY["@solidjs/web"])};
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
  types: [],
  paths: "@solidjs/web" in entries ? { "@solidjs/web": [web] } : undefined
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

function run(script: string, entries: Record<string, string> = ENTRIES) {
  const { resolved, report } = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: packageDir,
      encoding: "utf8"
    })
  );

  // Every entry must resolve to the generated declarations, or the check
  // would pass over files it never saw.
  expect(resolved).toEqual(Object.values(entries));
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
void fetch("/", { signal: options.signal });
${HYDRATION_API}`
    )
  );
}, 30000);

// Nothing here is DOM- or Node-specific, so a server or worker consumer with
// neither the DOM lib nor `@types/node` must not trip over a platform global.
test("the published declarations type-check without the DOM lib or @types/node", () => {
  run(check(["lib.es2022.d.ts"], HYDRATION_API));
}, 30000);

// The hydration API a data library migrates to from `sharedConfig` must be
// public — present in the published declarations, not stripped as
// `@internal` — and typed. The web package's own declarations are not
// reported: this test guards the probe's use of them.
test("the public hydration API is published and typed", () => {
  const entries = { ...ENTRIES, ...WEB_ENTRY };
  run(
    check(
      ["lib.es2022.d.ts", "lib.dom.d.ts"],
      HYDRATION_API + WEB_HYDRATION_API,
      entries,
      TYPE_DIRS
    ),
    entries
  );
}, 30000);
