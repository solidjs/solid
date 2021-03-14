import { mkdir, rm, exec } from "shelljs";
import { resolve, dirname, join } from "path";
import { download, extract } from "gitly";
import { existsSync } from "fs";

function makeTestRepo(
  name: string,
  install: (dependencies: string[]) => string = npmInstaller,
  test: string = "npm test"
) {
  return {
    name,
    install,
    test
  };
}
type TestRepo = ReturnType<typeof makeTestRepo>;

function npmInstaller(dependencies: string[]) {
  return dependencies.map(dep => `npm install --save "${dep}" --ignore-scripts`).join(" && ");
}

/** a function that tests a package */
async function testPackage(testRepo: TestRepo, dependencies: string[], isSilent = false) {
  const { name, install, test } = testRepo;

  const distFolder = resolve(join(__dirname, "fixtures", "downloaded", name));

  // download repository
  if (!packageExists(distFolder)) {
    const source = await download(name);
    mkdir("-p", distFolder);
    await extract(source, distFolder);
  }

  // run the tests
  if (packageExists(distFolder)) {
    exec(install(dependencies), {
      fatal: true,
      cwd: distFolder,
      silent: isSilent
    });

    exec(test, { fatal: true, cwd: distFolder, silent: isSilent });

    return true;
  }
  return false;
}

/** pack a package */
function pack(packageRoot: string) {
  const packageJson = join(packageRoot, "package.json");
  const pkg = require(packageJson);
  const packedPkg = join(packageRoot, `${pkg.name}-${pkg.version}.tgz`);
  rm("-rf", packedPkg);
  exec("npm pack", { cwd: packageRoot, fatal: true });
  return packedPkg;
}

function packageExists(packageRoot: string) {
  return existsSync(join(packageRoot, "package.json"));
}

describe("Downloaded tests", () => {
  // The repositories to run the tests for
  const testRepos: TestRepo[] = [makeTestRepo("aminya/solid-simple-table")];
  const clean = true;

  let packedSolidPkg: string, packedBabelSolidPkg: string, dependencies: string[];
  beforeAll(() => {
    // Check if solid is built
    if (!existsSync(resolve(join(__dirname, "../../solid/dist")))) {
      throw new Error("Solid is not built. Run `npm run build`");
    }

    // clean downloded packages
    if (clean) {
      rm("-rf", resolve(join(__dirname, "./fixtures/downloaded")));
    }

    // package solid and babel-preset-solid
    packedSolidPkg = pack(resolve(__dirname, "../../solid"));
    packedBabelSolidPkg = pack(resolve(__dirname, "../../babel-preset-solid"));
    dependencies = [packedSolidPkg, packedBabelSolidPkg];
  });

  // run the tests
  for (const testRepo of testRepos) {
    test(testRepo.name, async () => {
      const pass = await testPackage(testRepo, dependencies);
      expect(pass).toBe(true);
    });
  }

  afterAll(() => {
    rm("-rf", packedSolidPkg);
    rm("-rf", packedBabelSolidPkg);
  });
});
