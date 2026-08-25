// Snapshot suite for the `lazy()` module-URL pass (transformLazy).
//
// Locks the raw native output for every fixture in __tests__/lazy/fixtures.
// Unlike the parity suite this runs without any Babel normalization, so it
// also guards the printer output itself.
//
// Regenerate intentionally with:
//
//   UPDATE_LAZY_FIXTURES=1 pnpm exec vitest run __tests__/lazy-fixtures.test.js

const fs = require("fs");
const path = require("path");
const { fixtureNames, compileOxc } = require("./lazy/harness");

const fixtureDir = path.join(__dirname, "lazy", "fixtures");
const update = process.env.UPDATE_LAZY_FIXTURES === "1";

function expectSnapshot(fixture, actual) {
  const file = path.join(fixtureDir, fixture, "output.js");
  if (update) {
    fs.writeFileSync(file, actual);
  }
  expect(actual).toBe(fs.readFileSync(file, "utf8"));
}

describe("lazy module-URL output snapshots", () => {
  for (const fixture of fixtureNames()) {
    it(fixture, () => {
      const result = compileOxc(fixture);
      expectSnapshot(fixture, result.code.trimEnd() + "\n");
    });
  }
});
