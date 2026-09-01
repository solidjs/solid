import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
const branch = process.env.GITHUB_REF_NAME;
const releaseSha = process.env.GITHUB_SHA;

if (process.env.GITHUB_ACTIONS !== "true" || !repository || !branch || !releaseSha) {
  throw new Error("The coordinated release must run from the GitHub release workflow.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function output(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  }).trim();
}

function packageIsPublished(name, version) {
  return (
    spawnSync("npm", ["view", `${name}@${version}`, "version"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore"
    }).status === 0
  );
}

function remoteTagExists(tag) {
  return (
    spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore"
    }).status === 0
  );
}

function localTagExists(tag) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore"
    }).status === 0
  );
}

async function findDispatchedRun(startedAt) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const runs = JSON.parse(
      output("gh", [
        "run",
        "list",
        "--repo",
        repository,
        "--workflow",
        "compiler-binaries.yml",
        "--event",
        "workflow_dispatch",
        "--branch",
        branch,
        "--limit",
        "10",
        "--json",
        "databaseId,displayTitle,createdAt"
      ])
    );
    const run = runs.find(
      candidate =>
        candidate.displayTitle === `Compiler binaries ${releaseSha}` &&
        Date.parse(candidate.createdAt) >= startedAt - 5000
    );
    if (run) return String(run.databaseId);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out locating the dispatched compiler binary workflow.");
}

// Fail before publishing anything if the release commit cannot build or
// would publish broken tarballs.
run("pnpm", ["run", "build"]);
run("pnpm", ["run", "types"]);
run("node", ["scripts/check-release-invariants.mjs"]);
run("node", ["scripts/verify-release-artifacts.mjs"]);

const compiler = JSON.parse(
  fs.readFileSync(new URL("../packages/compiler/package.json", import.meta.url), "utf8")
);

if (!packageIsPublished(compiler.name, compiler.version)) {
  const startedAt = Date.now();
  const dispatchOutput = output("gh", [
    "workflow",
    "run",
    "compiler-binaries.yml",
    "--repo",
    repository,
    "--ref",
    branch,
    "-f",
    "publish=true",
    "-f",
    "npm-tag=next",
    "-f",
    `source-ref=${releaseSha}`
  ]);
  const runId =
    dispatchOutput.match(/actions\/runs\/(\d+)/)?.[1] ?? (await findDispatchedRun(startedAt));

  console.log(`Waiting for compiler platform packages: ${runId}`);
  run("gh", ["run", "watch", runId, "--repo", repository, "--exit-status"]);
} else {
  console.log(`${compiler.name}@${compiler.version} is already published; skipping binaries.`);
}

// Changesets forbids a custom dist-tag while pre mode is active: `publish`
// would use the semver prerelease name (`rc`) instead of the channel (`next`).
// Publish the fixed group directly, with internal dependencies first.
const changesetConfig = JSON.parse(fs.readFileSync(".changeset/config.json", "utf8"));
const releaseNames = new Set(changesetConfig.fixed.flat());
const packages = new Map();

for (const entry of fs.readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = `packages/${entry.name}`;
  const manifest = `${directory}/package.json`;
  if (!fs.existsSync(manifest)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (releaseNames.has(pkg.name)) packages.set(pkg.name, { directory, pkg });
}

for (const name of releaseNames) {
  if (!packages.has(name)) throw new Error(`Fixed package ${name} was not found in packages/.`);
}

const packageDirectories = [];
const visited = new Set();
const visiting = new Set();
function visit(name) {
  if (visited.has(name) || visiting.has(name)) return;
  visiting.add(name);
  const { directory, pkg } = packages.get(name);
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies
  };
  for (const dependency of Object.keys(dependencies)) {
    if (packages.has(dependency)) visit(dependency);
  }
  visiting.delete(name);
  visited.add(name);
  packageDirectories.push(directory);
}
for (const name of releaseNames) visit(name);

const released = [];

for (const directory of packageDirectories) {
  const pkg = JSON.parse(fs.readFileSync(`${directory}/package.json`, "utf8"));
  if (!packageIsPublished(pkg.name, pkg.version)) {
    run("npm", ["publish", `./${directory}`, "--access", "public", "--tag", "next"]);
  } else {
    console.log(`${pkg.name}@${pkg.version} is already published; skipping.`);
  }
  released.push(pkg);
}

// changesets/action consumes these lines to push package tags and create the
// matching GitHub releases. Check the remote first so ordinary pushes and
// partial-release retries stay idempotent.
for (const pkg of released) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (!remoteTagExists(tag)) {
    if (!localTagExists(tag)) run("git", ["tag", tag]);
    console.log(`New tag: ${tag}`);
  }
}
