// Snapshot suite for the `"use server"` directive pass (transformDirectives).
//
// Locks the native output for every fixture in __tests__/directives/fixtures
// in both modes, plus the reported function metadata. Unlike the parity
// suite this runs without the vite-plugin-solid reference checkout.
//
// Regenerate intentionally with:
//
//   UPDATE_DIRECTIVES_FIXTURES=1 pnpm exec vitest run __tests__/directives-fixtures.test.js

const fs = require("fs");
const path = require("path");
const { fixtureNames, compileOxc } = require("./directives/harness");

const fixtureDir = path.join(__dirname, "directives", "fixtures");
const update = process.env.UPDATE_DIRECTIVES_FIXTURES === "1";

function snapshotPath(fixture, name) {
  return path.join(fixtureDir, fixture, name);
}

function expectSnapshot(fixture, name, actual) {
  const file = snapshotPath(fixture, name);
  if (update) {
    fs.writeFileSync(file, actual);
  }
  expect(actual).toBe(fs.readFileSync(file, "utf8"));
}

describe('"use server" directive output snapshots', () => {
  for (const fixture of fixtureNames()) {
    describe(fixture, () => {
      it.each(["server", "client"])("%s", mode => {
        const result = compileOxc(fixture, mode, "production");
        expectSnapshot(fixture, `output.${mode}.js`, result.code.trimEnd() + "\n");
      });

      it("reports function metadata", () => {
        const server = compileOxc(fixture, "server", "production");
        const client = compileOxc(fixture, "client", "production");
        // Both builds must agree on the manifest (IDs are the wire format).
        expect(client.functions).toEqual(server.functions);
        expect(client.valid).toBe(server.valid);
        expectSnapshot(
          fixture,
          "meta.json",
          JSON.stringify({ valid: server.valid, functions: server.functions }, null, 2) + "\n"
        );
      });
    });
  }
});
