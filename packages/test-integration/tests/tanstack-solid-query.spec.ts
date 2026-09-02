import { beforeAll, describe, expect, test } from "vitest";
import { exec, mkdir, rm } from "shelljs";
import { download, extract } from "gitly";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { join, resolve } from "path";

/**
 * Release gate: the TanStack Solid Query adapter's full suite against the
 * WORKSPACE-BUILT core — solid-js, @solidjs/signals, and @solidjs/web packed
 * from this tree and installed together, never a registry mix.
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
// next core break the adapter people will install alongside it". Today that
// adapter lives on the PR branch carrying the Solid 2.0 pairing
// (TanStack/query#11326: named flight source, @solidjs/vite-plugin, the
// solid-js/web alias its vitest config needs to run against a 2.0 core);
// flip this to "TanStack/query" once it merges.
const QUERY_REPO = process.env.SOLID_QUERY_GATE_REPO ?? "ryansolid/query#feat/flight-data-source";

const CORE_PACKAGES = ["signals", "solid", "web"] as const;

function pack(packageRoot: string) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const result = exec("npm pack --json", { cwd: packageRoot, fatal: true, silent: true });
  const packedPkg = JSON.parse(result.stdout)[0].filename;
  return { name: pkg.name as string, path: join(packageRoot, packedPkg) };
}

describe("TanStack Solid Query against workspace-built core", () => {
  const queryRepoDir = resolve(
    join(__dirname, "fixtures", "downloaded", QUERY_REPO.replace(/[#/]/g, "-"))
  );
  let tarballs: Array<{ name: string; path: string }>;

  beforeAll(async () => {
    for (const dir of CORE_PACKAGES) {
      if (!existsSync(resolve(join(__dirname, `../../${dir}/dist`)))) {
        throw new Error(`packages/${dir} is not built. Run \`pnpm build\` first.`);
      }
    }
    tarballs = CORE_PACKAGES.map(dir => pack(resolve(join(__dirname, `../../${dir}`))));

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
    const overrideLines = tarballs.map(t => `  '${t.name}': 'file:${t.path}'`).join("\n");
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

    // The suite's typecheck half resolves @tanstack/query-core through
    // project references — dist-ts must exist (`tsc --build` follows the
    // reference graph).
    exec("pnpm run compile", { cwd: solidQueryDir, fatal: true });

    const result = exec("npx vitest run", { cwd: solidQueryDir, fatal: false });
    expect(result.code).toBe(0);
  }, 900_000);
});
