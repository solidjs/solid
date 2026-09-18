import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exec, mkdir, rm } from "shelljs";
import { download, extract } from "gitly";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

/**
 * Release gate: the TanStack Solid Query adapter's full suite against the
 * WORKSPACE-BUILT core — solid-js, @solidjs/signals, and @solidjs/web packed
 * from this tree and installed together, never a registry mix — compiled by
 * the WORKSPACE-BUILT compiler (@solidjs/compiler with this tree's native
 * binding, @solidjs/babel-plugin), never the registry's.
 *
 * Both halves matter. Compiled output and runtime are one contract: rc.9
 * moved delegated event handlers to the `_$$<type>` key, and against the
 * fixture's published compiler (still emitting `$$<type>`) every click in
 * the suite was a no-op — 95 failures, none of them adapter semantics, and
 * circular: the fixture could not pick up the new compiler until the
 * release was on npm, and the gate blocked the release (#3534).
 *
 * This exists because core-side suites structurally cannot protect the
 * adapter contract. The rc.5 regression (#3181's fix waking parked readers
 * into uninitialized projections) was invisible to every core test: a
 * premature wake is self-healing for ordinary async nodes (pending reads
 * throw and re-park) and only corrupts through the adapter's exact
 * composition — an empty-seed projection over a stable chained promise with
 * render effects parked under a boundary. Clean-room repros of that shape
 * pass; only the adapter's own suite fails. So the adapter's suite runs
 * here, against the bits a release would ship.
 *
 * Run via `pnpm run test:solid-query` in this package (invoked by
 * scripts/release.mjs before publish). Needs network (repo download +
 * registry install) and several minutes on a cold store — deliberately not
 * part of the default offline `test` script.
 */

// The ref the gate tracks — overridable for one-off runs via
// SOLID_QUERY_GATE_REPO. The question a release must answer is "does OUR
// next core break the adapter people will install alongside it". That
// adapter is @tanstack/solid-query 6 (the `rc` dist-tag), developed and
// released from TanStack's `solid-query-v6-pre` branch — the Solid 2.0
// pairing (TanStack/query#11326) merged there, not `main`, which still
// carries the Solid 1.x adapter. Flip to "TanStack/query" when v6 lands on
// main.
const QUERY_REPO = process.env.SOLID_QUERY_GATE_REPO ?? "TanStack/query#solid-query-v6-pre";

const CORE_PACKAGES = ["signals", "solid", "web"] as const;
// The compiler side of the contract. The fixture's @solidjs/vite-plugin
// loads both: @solidjs/compiler in every mode (lazy/refresh/server-function
// passes and, by default, JSX), @solidjs/babel-plugin for `compiler: "babel"`.
const COMPILER_PACKAGES = ["compiler", "babel-plugin"] as const;
// @solidjs/compiler's optionalDependencies pin platform binaries to THIS
// version, which reaches the registry only after release.mjs publishes them
// — after this gate. Resolve them to the in-repo stubs (no .node inside),
// exactly as the workspace's own pnpm-workspace.yaml does, and hand the
// loader the locally built binding through SOLID_COMPILER_NATIVE.
const COMPILER_PLATFORMS = [
  "darwin-x64",
  "darwin-arm64",
  "linux-x64-gnu",
  "linux-arm64-gnu",
  "win32-x64-msvc",
  "wasm32-wasi"
] as const;

const repoRoot = resolve(join(__dirname, "../../.."));
const packageRoot = (dir: string) => join(repoRoot, "packages", dir);

function pack(packageRoot: string) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const result = exec("npm pack --json", { cwd: packageRoot, fatal: true, silent: true });
  const packedPkg = JSON.parse(result.stdout)[0].filename;
  return { name: pkg.name as string, path: join(packageRoot, packedPkg) };
}

// Newest mtime under a directory tree — the honest "when was this last
// touched" for a source folder.
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

// The native binding `pnpm --filter @solidjs/compiler run build` leaves next
// to index.js, in the loader's own preference order. The published package
// ships no local binary (see its "files"), so the packed tarball needs this
// handed to it explicitly.
function locateCompilerBinding(): string {
  const compilerDir = packageRoot("compiler");
  const { platform, arch } = process;
  const suffix =
    platform === "darwin" && (arch === "x64" || arch === "arm64")
      ? `darwin-${arch}`
      : platform === "linux" && (arch === "x64" || arch === "arm64")
        ? `linux-${arch}-gnu`
        : platform === "win32" && arch === "x64"
          ? "win32-x64-msvc"
          : null;
  const candidates = suffix ? [`compiler.${suffix}.node`, "compiler.node"] : ["compiler.node"];
  const found = candidates.map(file => join(compilerDir, file)).find(existsSync);
  if (!found) {
    throw new Error(
      "packages/compiler has no native binding. Run `pnpm --filter @solidjs/compiler run build` first."
    );
  }
  // A binding older than the compiler's sources would silently gate the
  // release on the previous compiler — the exact failure this gate exists
  // to catch. (CI builds it in the release job; this guards local runs.)
  if (statSync(found).mtimeMs < newestMtime(join(compilerDir, "src"))) {
    throw new Error(
      `${found} is older than packages/compiler/src. Rebuild with \`pnpm --filter @solidjs/compiler run build\`.`
    );
  }
  return found;
}

describe("TanStack Solid Query against workspace-built core", () => {
  const queryRepoDir = resolve(
    join(__dirname, "fixtures", "downloaded", QUERY_REPO.replace(/[#/]/g, "-"))
  );
  let tarballs: Array<{ name: string; path: string }> = [];
  let compilerBinding: string;

  // The tarballs are packed into their package directories (untracked
  // there); pnpm has copied them into its store by the time the suite ran.
  afterAll(() => {
    for (const { path } of tarballs) rm("-f", path);
  });

  beforeAll(async () => {
    for (const dir of CORE_PACKAGES) {
      if (!existsSync(join(packageRoot(dir), "dist"))) {
        throw new Error(`packages/${dir} is not built. Run \`pnpm build\` first.`);
      }
    }
    if (!existsSync(join(packageRoot("babel-plugin"), "index.js"))) {
      throw new Error("packages/babel-plugin is not built. Run `pnpm build` first.");
    }
    compilerBinding = locateCompilerBinding();
    tarballs = [...CORE_PACKAGES, ...COMPILER_PACKAGES].map(dir => pack(packageRoot(dir)));

    // Fresh download every run: the gate must see TanStack's current main,
    // and a stale extraction with a mutated lockfile would poison reruns.
    rm("-rf", queryRepoDir);
    const source = await download(QUERY_REPO);
    mkdir("-p", queryRepoDir);
    await extract(source, queryRepoDir);
  }, 300_000);

  test("solid-query suite is green", () => {
    expect(existsSync(join(queryRepoDir, "pnpm-workspace.yaml"))).toBe(true);

    // pnpm 11 reads overrides from pnpm-workspace.yaml (package.json
    // pnpm.overrides is silently ignored there — measured, not assumed).
    const workspaceYamlPath = join(queryRepoDir, "pnpm-workspace.yaml");
    const workspaceYaml = readFileSync(workspaceYamlPath, "utf8");
    // The fixture's own @solidjs/vite-plugin predates the switch from
    // @dom-expressions/compiler to @solidjs/compiler; older plugins ignore the
    // packed compiler entirely. Lift it to the plugin this tree is tested
    // with — the root devDependency, one source of truth — so the fixture is
    // compiled through the same plugin the examples and suites use.
    const vitePluginVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
      .devDependencies["@solidjs/vite-plugin"];
    expect(vitePluginVersion, "root devDependency @solidjs/vite-plugin").toBeTruthy();
    const overrideLines = [
      ...tarballs.map(t => `  '${t.name}': 'file:${t.path}'`),
      ...COMPILER_PLATFORMS.map(
        p => `  '@solidjs/compiler-${p}': 'link:${join(packageRoot("compiler"), "npm", p)}'`
      ),
      `  '@solidjs/vite-plugin': '${vitePluginVersion}'`
    ].join("\n");
    if (/^overrides:/m.test(workspaceYaml)) {
      writeFileSync(
        workspaceYamlPath,
        workspaceYaml.replace(/^overrides:/m, `overrides:\n${overrideLines}`)
      );
    } else {
      appendFileSync(workspaceYamlPath, `\noverrides:\n${overrideLines}\n`);
    }

    // The file: overrides above deliberately differ from the downloaded
    // repository's lockfile, so this fixture cannot use CI's frozen default.
    exec("pnpm install --no-frozen-lockfile", { cwd: queryRepoDir, fatal: true });

    // Belt and braces: assert the override actually resolved this tree's
    // build — a silent fallback to the registry would make a green run
    // meaningless (exactly the failure mode that let rc.5 ship). A version
    // comparison cannot tell the two apart (the registry may carry the
    // same version string); pnpm materializes file: overrides under a
    // store path containing `file+`, so the symlink's real path is the
    // honest probe.
    const solidQueryDir = join(queryRepoDir, "packages", "solid-query");
    const fromTarball = (path: string, dep: string) => {
      expect(existsSync(path), `${dep} is not installed`).toBe(true);
      const real = realpathSync(path);
      expect(
        real.includes("file+"),
        `${dep} resolved from the registry instead of the workspace tarball`
      ).toBe(true);
      return real;
    };
    const solidJsReal = fromTarball(join(solidQueryDir, "node_modules", "solid-js"), "solid-js");
    // signals is transitive (a dependency of solid-js), so it only exists
    // in the store — probe it through solid-js's sibling links.
    fromTarball(join(solidJsReal, "..", "@solidjs", "signals"), "@solidjs/signals");
    // @solidjs/web becomes a solid-query dependency with TanStack/query
    // PR #11326; on earlier mains nothing requests it, so there is
    // nothing the registry could poison. When present it must be ours.
    const webLink = join(solidQueryDir, "node_modules", "@solidjs", "web");
    if (existsSync(webLink)) fromTarball(webLink, "@solidjs/web");
    // The compiler pair is requested by @solidjs/vite-plugin, not by
    // solid-query, so probe it through the plugin's own resolution — the
    // path the fixture's vite config actually loads.
    const vitePluginReal = realpathSync(
      join(solidQueryDir, "node_modules", "@solidjs", "vite-plugin")
    );
    expect(
      JSON.parse(readFileSync(join(vitePluginReal, "package.json"), "utf8")).version,
      "@solidjs/vite-plugin was not lifted to the workspace's version"
    ).toBe(vitePluginVersion);
    // (vitePluginReal is `<store>/node_modules/@solidjs/vite-plugin`; its
    // dependencies are siblings under the same scope directory.)
    for (const name of ["@solidjs/compiler", "@solidjs/babel-plugin"]) {
      fromTarball(join(vitePluginReal, "..", name.slice("@solidjs/".length)), name);
    }

    // The suite's typecheck half resolves @tanstack/query-core through
    // project references — dist-ts must exist (`tsc --build` follows the
    // reference graph).
    exec("pnpm run compile", { cwd: solidQueryDir, fatal: true });

    // spawnSync, not shelljs: a runner that dies on a signal (V8's heap OOM
    // aborts) has no exit code, and shelljs reported that as 0 — a crashed
    // suite read as green. Judge the exit and the signal separately.
    const result = spawnSync("npx", ["vitest", "run"], {
      cwd: solidQueryDir,
      stdio: "inherit",
      env: { ...process.env, SOLID_COMPILER_NATIVE: compilerBinding }
    });
    expect(result.error, "vitest could not be started").toBeUndefined();
    expect(result.signal, "vitest was killed by a signal").toBeNull();
    expect(result.status, "vitest exit status").toBe(0);
  }, 900_000);
});
