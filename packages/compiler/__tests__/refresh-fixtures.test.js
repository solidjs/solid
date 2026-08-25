// Snapshot suite for the solid-refresh HMR pass (transformRefresh).
//
// Locks the raw native output for every fixture in
// __tests__/refresh/fixtures. Unlike the parity suite this runs without any
// Babel normalization, so it also guards the native printer output itself.
//
// Regenerate intentionally with:
//
//   UPDATE_REFRESH_FIXTURES=1 pnpm exec vitest run __tests__/refresh-fixtures.test.js

const fs = require("fs");
const path = require("path");
const { fixtureNames, compileOxc } = require("./refresh/harness");

const fixtureDir = path.join(__dirname, "refresh", "fixtures");
const update = process.env.UPDATE_REFRESH_FIXTURES === "1";

function expectSnapshot(fixture, actual) {
  const file = path.join(fixtureDir, fixture, "output.js");
  if (update) {
    fs.writeFileSync(file, actual);
  }
  expect(actual).toBe(fs.readFileSync(file, "utf8"));
}

describe("solid-refresh output snapshots", () => {
  for (const fixture of fixtureNames()) {
    it(fixture, () => {
      const result = compileOxc(fixture);
      expectSnapshot(fixture, result.code.trimEnd() + "\n");
    });
  }
});
