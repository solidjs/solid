// solid-js 1.x publishes to the `v1-latest` dist-tag (see publishConfig in
// packages/solid/package.json) so it never takes `latest` from 2.x.
// `changeset publish` always passes `--tag latest`, which overrides
// publishConfig, so solid-js is published here first. `changeset publish`
// then sees the version on npm, skips it, and still creates its git tag.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dir = new URL("../packages/solid/", import.meta.url);
const { name, version } = JSON.parse(readFileSync(new URL("package.json", dir), "utf8"));

let published = "";
try {
  published = execFileSync("npm", ["view", `${name}@${version}`, "version", "--prefer-online"], {
    encoding: "utf8"
  }).trim();
} catch (e) {
  if (!String(e.stderr).includes("E404")) throw e;
}

if (published) {
  console.log(`${name}@${version} is already on npm, skipping`);
} else {
  execFileSync("pnpm", ["publish", "--no-git-checks"], { cwd: dir, stdio: "inherit" });
}
