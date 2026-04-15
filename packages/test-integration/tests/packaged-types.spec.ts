import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exec, rm } from "shelljs";
import { cpSync, existsSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";

function pack(packageRoot: string) {
  const packageJson = join(packageRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
  const packedPrefix = pkg.name.replace(/^@/, "").replace(/\//g, "-");
  rm("-rf", join(packageRoot, `${packedPrefix}-${pkg.version}.tgz`));
  const result = exec("npm pack --json", { cwd: packageRoot, fatal: true, silent: true });
  const packedPkg = JSON.parse(result.stdout)[0].filename;
  return join(packageRoot, packedPkg);
}

describe("Packed package type resolution", () => {
  const fixtureSource = resolve(join(__dirname, "..", "fixtures", "packaged-types", "node16-cjs"));
  const fixtureRun = resolve(join(__dirname, "..", "fixtures", ".generated", "node16-cjs"));
  const rootPackageJson = JSON.parse(
    readFileSync(resolve(join(__dirname, "../../..", "package.json")), "utf8")
  );
  const typescriptVersion = rootPackageJson.devDependencies.typescript;
  const packageRoots = [
    resolve(join(__dirname, "../../solid-signals")),
    resolve(join(__dirname, "../../solid")),
    resolve(join(__dirname, "../../solid-web")),
    resolve(join(__dirname, "../../solid-h")),
    resolve(join(__dirname, "../../solid-html")),
    resolve(join(__dirname, "../../solid-universal"))
  ];
  const packedPackages: string[] = [];

  beforeAll(() => {
    for (const packageRoot of packageRoots) {
      if (!existsSync(resolve(join(packageRoot, "dist")))) {
        throw new Error(`Package is not built: ${packageRoot}`);
      }
    }

    rmSync(fixtureRun, { recursive: true, force: true });
    cpSync(fixtureSource, fixtureRun, { recursive: true });

    for (const packageRoot of packageRoots) {
      packedPackages.push(pack(packageRoot));
    }

    exec(`npm install --save-dev "typescript@${typescriptVersion}" --ignore-scripts`, {
      cwd: fixtureRun,
      fatal: true,
      silent: true
    });

    exec(packedPackages.map(dep => `npm install --save "${dep}" --ignore-scripts`).join(" && "), {
      cwd: fixtureRun,
      fatal: true,
      silent: true
    });
  });

  test("Node16 CommonJS consumers can import packed packages", () => {
    const result = exec("npx tsc -p tsconfig.json", { cwd: fixtureRun, silent: true });
    expect(result.code).toBe(0);
  });

  afterAll(() => {
    rmSync(fixtureRun, { recursive: true, force: true });
    for (const packedPackage of packedPackages) {
      rm("-rf", packedPackage);
    }
  });
});
