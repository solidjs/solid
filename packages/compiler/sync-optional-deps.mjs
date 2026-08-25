// Keeps optionalDependencies on the platform binary packages pinned to the
// main package version. Run after `napi version` (see the root `version` script).
import fs from "node:fs";

const path = new URL("./package.json", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));

for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
  if (name.startsWith("@solidjs/compiler-")) {
    pkg.optionalDependencies[name] = pkg.version;
  }
}

fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log(`optionalDependencies pinned to ${pkg.version}`);
