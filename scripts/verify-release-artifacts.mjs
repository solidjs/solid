// Dry-run-publishes every fixed-group package and asserts the tarball would
// contain the manifest's entry points (main/module/types/browser/bin/exports).
// Catches broken `files` globs, missing dist output, and manifest mistakes
// BEFORE release.mjs publishes anything. Requires a completed build
// (`pnpm run build && pnpm run types`); runs npm with --ignore-scripts so
// prepublish hooks do not re-build.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const changesetConfig = JSON.parse(fs.readFileSync(".changeset/config.json", "utf8"));
const releaseNames = new Set(changesetConfig.fixed.flat());

const directories = new Map();
for (const entry of fs.readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = `packages/${entry.name}/package.json`;
  if (!fs.existsSync(manifest)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (releaseNames.has(pkg.name)) directories.set(pkg.name, { directory: `packages/${entry.name}`, pkg });
}

for (const name of releaseNames) {
  if (!directories.has(name)) throw new Error(`Fixed package ${name} was not found in packages/.`);
}

// Collect the relative file paths the manifest points consumers at. Wildcard
// exports and non-string leaves are skipped — only concrete paths are checked.
function collectEntryFiles(pkg) {
  const entries = new Set();
  const add = value => {
    if (typeof value !== "string" || !value || value.includes("*")) return;
    entries.add(value.replace(/^\.\//, ""));
  };
  add(pkg.main);
  add(pkg.module);
  add(pkg.types);
  add(pkg.browser);
  if (typeof pkg.bin === "string") add(pkg.bin);
  else if (pkg.bin) Object.values(pkg.bin).forEach(add);
  const walk = node => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  if (pkg.exports) walk(pkg.exports);
  return entries;
}

const failures = [];

for (const [name, { directory, pkg }] of directories) {
  let report;
  try {
    const stdout = execFileSync(
      "npm",
      ["publish", "--dry-run", "--ignore-scripts", "--json", "--access", "public", "--tag", "next"],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    // npm keys the --json report by package name.
    report = JSON.parse(stdout)[name];
    if (!report?.files) throw new Error(`unexpected npm --json output: ${stdout.slice(0, 200)}`);
  } catch (error) {
    failures.push(`${name}: npm publish --dry-run failed:\n${error.stderr || error.message}`);
    continue;
  }

  const files = new Set(report.files.map(file => file.path));
  const missing = [...collectEntryFiles(pkg)].filter(entry => !files.has(entry));
  if (missing.length > 0) {
    failures.push(
      `${name}: the published tarball would be missing manifest entry points: ${missing.join(", ")}`
    );
  } else {
    console.log(`${name}@${pkg.version}: ${files.size} files, all entry points present.`);
  }
}

if (failures.length > 0) {
  console.error("\nRelease artifact verification failed:\n");
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
