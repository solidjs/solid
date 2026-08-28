// Post-publish smoke test: installs the just-released packages from the REAL
// registry into a temp project and exercises them — dist-tag correctness, the
// compiler's native binary actually loading and transforming, and the core
// runtime executing. Catches a botched platform binary or bad
// optionalDependencies pin minutes after publishing instead of via user
// reports. Runs from the repo root on the release commit.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const version = JSON.parse(fs.readFileSync("packages/solid/package.json", "utf8")).version;
const changesetConfig = JSON.parse(fs.readFileSync(".changeset/config.json", "utf8"));
const fixedPackages = changesetConfig.fixed.flat();

function npm(args, options = {}) {
  const stdout = execFileSync("npm", args, { encoding: "utf8", ...options });
  return stdout === null ? "" : stdout.trim();
}

async function withRetries(label, attempts, action) {
  for (let attempt = 1; ; attempt++) {
    try {
      return action();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`${label} failed (attempt ${attempt}/${attempts}), retrying in 20s...`);
      await new Promise(resolve => setTimeout(resolve, 20000));
    }
  }
}

// Registry propagation can lag the publish by a few seconds.
await withRetries("dist-tag check", 5, () => {
  for (const name of fixedPackages) {
    const tagged = npm(["view", name, "dist-tags.next"]);
    if (tagged !== version) {
      throw new Error(`${name} dist-tag 'next' is ${tagged}, expected ${version}.`);
    }
  }
});
console.log(`dist-tag 'next' points at ${version} for all ${fixedPackages.length} packages.`);

const project = fs.mkdtempSync(path.join(os.tmpdir(), "solid-smoke-"));
fs.writeFileSync(
  path.join(project, "package.json"),
  JSON.stringify({ name: "solid-smoke", private: true, type: "module" })
);

await withRetries("install", 3, () => {
  npm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      `solid-js@${version}`,
      `@solidjs/web@${version}`,
      `@solidjs/compiler@${version}`
    ],
    { cwd: project, stdio: ["ignore", "inherit", "inherit"] }
  );
});

fs.writeFileSync(
  path.join(project, "smoke.mjs"),
  `
import assert from "node:assert/strict";
import { transform } from "@solidjs/compiler";
import { createSignal, createMemo, flush } from "solid-js";
import { renderToString } from "@solidjs/web";

// The native binary loads and compiles JSX.
const { code } = transform("const App = () => <div>{name()}</div>;", { filename: "App.jsx" });
assert.match(code, /template/, "compiled output should reference the template runtime");

// The core runtime executes. Plain Node resolves the SERVER build, where
// signal writes are inert (server render is pure), so test pure derivation.
const [count] = createSignal(21);
const doubled = createMemo(() => count() * 2);
flush();
assert.equal(doubled(), 42);

assert.equal(typeof renderToString, "function");

console.log("smoke: compiler transform + runtime OK");
`
);
execFileSync("node", ["smoke.mjs"], { cwd: project, stdio: "inherit" });

console.log(`Smoke test passed for ${version}.`);
