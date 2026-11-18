// The packages the release pipeline publishes: every non-private package in
// packages/. They no longer share one version (see .changeset/config.json:
// the core runtime is a fixed group, the compilers are linked, and h, html
// and element version on their own), so each package carries its own
// version and dist-tag.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

// A prerelease version (2.1.0-rc.N) publishes to the `next` channel; a
// stable version publishes to `latest`.
export function distTagFor(version) {
  return version.includes("-") ? "next" : "latest";
}

// Whether `name@version` is already on npm. A package whose version did not
// move this release (h, html and element version on their own) is already
// published, and npm refuses to publish over it, even in a dry run.
export function packageIsPublished(name, version) {
  return (
    spawnSync("npm", ["view", `${name}@${version}`, "version"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore"
    }).status === 0
  );
}

export function releasePackages(root = ".") {
  const packages = new Map();
  for (const entry of fs.readdirSync(`${root}/packages`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = `packages/${entry.name}`;
    const manifest = `${root}/${directory}/package.json`;
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (pkg.private) continue;
    packages.set(pkg.name, { directory, pkg });
  }

  // Every package a changesets group names must exist and be publishable.
  const config = JSON.parse(fs.readFileSync(`${root}/.changeset/config.json`, "utf8"));
  for (const name of [...config.fixed.flat(), ...config.linked.flat()]) {
    if (!packages.has(name)) {
      throw new Error(
        `.changeset/config.json names ${name}, which is not a public package in packages/.`
      );
    }
  }
  return packages;
}
