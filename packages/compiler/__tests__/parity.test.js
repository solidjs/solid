// Babel vs Oxc output parity ratchet.
//
// Every Babel fixture is compiled with BOTH compilers under identical options
// and the normalized outputs are diffed (see parity/harness.js). The diff for
// each fixture is locked in under parity/expected/<mode>/<fixture>.diff:
//
// - An ABSENT expectation file means the compilers are at parity for that
//   fixture and must stay there.
// - A PRESENT expectation file documents the current known divergence. Any
//   change — regression or improvement — fails until the expectation is
//   regenerated and the change is reviewed.
//
// Regenerate intentionally with:
//
//   UPDATE_PARITY=1 pnpm exec vitest run __tests__/parity.test.js
//
// and review the resulting git diff. Reaching parity on a fixture deletes its
// expectation file; never hand-edit these files.

const fs = require("fs");
const path = require("path");
const { modes, fixtureNames, compareFixture, unifiedDiff } = require("./parity/harness");

const expectedDir = path.join(__dirname, "parity", "expected");
const update = process.env.UPDATE_PARITY === "1";

function expectationPath(mode, fixture) {
  return path.join(expectedDir, mode, `${fixture}.diff`);
}

function readExpectation(mode, fixture) {
  const file = expectationPath(mode, fixture);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeExpectation(mode, fixture, diff) {
  const file = expectationPath(mode, fixture);
  if (diff === "") {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, diff);
}

describe("Babel vs Oxc compiler output parity", () => {
  for (const mode of Object.keys(modes)) {
    describe(mode, () => {
      it.each(fixtureNames(mode))("%s", fixture => {
        const { babel, oxc } = compareFixture(mode, fixture);
        const diff = unifiedDiff(babel, oxc);
        if (update) {
          writeExpectation(mode, fixture, diff);
          return;
        }
        const expected = readExpectation(mode, fixture);
        if (diff === expected) return;
        const relative = path.relative(
          path.resolve(__dirname, "../.."),
          expectationPath(mode, fixture)
        );
        if (expected === "") {
          throw new Error(
            `${mode}/${fixture} was at parity with babel-plugin but now diverges ` +
              `(normalized diff below, babel = "-", oxc = "+").\n` +
              `If this divergence is intentional, regenerate expectations with ` +
              `UPDATE_PARITY=1 and commit ${relative}.\n\n${diff}`
          );
        }
        if (diff === "") {
          throw new Error(
            `${mode}/${fixture} reached parity with babel-plugin. ` +
              `Regenerate expectations with UPDATE_PARITY=1 to delete ${relative}.`
          );
        }
        throw new Error(
          `${mode}/${fixture} diverges from babel-plugin differently than the ` +
            `recorded expectation (babel = "-", oxc = "+").\n` +
            `Review the change; if intentional, regenerate with UPDATE_PARITY=1 ` +
            `and commit ${relative}.\n\n` +
            unifiedDiff(expected, diff)
        );
      });
    });
  }

  it("has no stale expectation files", () => {
    if (!fs.existsSync(expectedDir)) return;
    const known = new Set();
    for (const mode of Object.keys(modes)) {
      for (const fixture of fixtureNames(mode)) {
        known.add(path.join(mode, `${fixture}.diff`));
      }
    }
    const stale = [];
    for (const mode of fs.readdirSync(expectedDir)) {
      const modeDir = path.join(expectedDir, mode);
      if (!fs.statSync(modeDir).isDirectory()) continue;
      for (const file of fs.readdirSync(modeDir)) {
        if (!known.has(path.join(mode, file))) stale.push(path.join(mode, file));
      }
    }
    expect(stale).toEqual([]);
  });
});
