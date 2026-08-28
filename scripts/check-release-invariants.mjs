// Guards the workspace layout the release pipeline depends on. These
// invariants were violated once (the rc.4 outage): registry resolution of the
// compiler platform packages let the version PR pin optionalDependencies to a
// version that reaches npm only after the release publishes, so the bot's
// lockfile refresh dropped the unresolvable entries and every frozen install
// on the release commit failed before any workflow could run.
//
// Run from the repo root. Exits non-zero with an explanation per violation.
import fs from "node:fs";

const failures = [];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const compilerManifest = JSON.parse(fs.readFileSync("packages/compiler/package.json", "utf8"));
const platformPackages = Object.keys(compilerManifest.optionalDependencies ?? {}).filter(name =>
  name.startsWith("@solidjs/compiler-")
);
if (platformPackages.length === 0) {
  failures.push(
    "packages/compiler/package.json lists no @solidjs/compiler-* optionalDependencies; " +
      "the platform binary packages must be declared there."
  );
}

const changesetConfig = JSON.parse(fs.readFileSync(".changeset/config.json", "utf8"));
const fixedPackages = changesetConfig.fixed.flat();

const workspaceYaml = fs.readFileSync("pnpm-workspace.yaml", "utf8");

// The compiler must resolve to the workspace so every consumer (the vite
// plugin in the element/web suites especially) tests the local build instead
// of the last published release.
if (!/^\s*['"]?@solidjs\/compiler['"]?:\s*['"]?workspace:/m.test(workspaceYaml)) {
  failures.push(
    "pnpm-workspace.yaml must override '@solidjs/compiler' to 'workspace:*' — without it, " +
      "test suites silently run against the last PUBLISHED compiler instead of the code under review."
  );
}

// The platform packages must be link-stubbed so the lockfile stays
// version-independent; a registry resolution deadlocks the release (see top).
for (const name of platformPackages) {
  const target = `packages/compiler/npm/${name.slice("@solidjs/compiler-".length)}`;
  const pattern = new RegExp(
    `^\\s*['"]?${escapeRegExp(name)}['"]?:\\s*['"]?link:${escapeRegExp(target)}['"]?\\s*$`,
    "m"
  );
  if (!pattern.test(workspaceYaml)) {
    failures.push(
      `pnpm-workspace.yaml must override '${name}' to 'link:${target}' — registry resolution ` +
        "deadlocks frozen installs on the release commit (optionalDependencies get bumped to a " +
        "version that is not on npm yet)."
    );
  }
  if (!fs.existsSync(`${target}/package.json`)) {
    failures.push(`The link stub '${target}/package.json' is missing.`);
  }
}

// No release-versioned package may be registry-resolved in the lockfile: a
// pinned entry either deadlocks the next release (platform packages) or means
// some dependency chain tests published code instead of the workspace.
const lockfile = fs.readFileSync("pnpm-lock.yaml", "utf8");
for (const name of [...fixedPackages, ...platformPackages]) {
  const pattern = new RegExp(`^\\s*['"]?${escapeRegExp(name)}@\\d[^:]*['"]?:`, "m");
  const match = lockfile.match(pattern);
  if (match) {
    failures.push(
      `pnpm-lock.yaml resolves '${name}' from the registry (${match[0].trim()}). All release-` +
        "versioned packages must resolve to the workspace (check the overrides in pnpm-workspace.yaml)."
    );
  }
}

if (failures.length > 0) {
  console.error("Release invariant violations:\n");
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(
  `Release invariants hold: ${platformPackages.length} platform link stubs, ` +
    `${fixedPackages.length} fixed packages workspace-resolved.`
);
