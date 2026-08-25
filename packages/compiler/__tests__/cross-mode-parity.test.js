// Cross-mode fixture-union parity ratchet.
//
// parity.test.js checks each mode against its OWN fixture directory. This
// suite compiles the UNION of all Babel fixture sources through EVERY mode
// with both compilers, so a construct exercised only by (say) the dom
// fixtures is also locked in for ssr and universal. This is the guardrail
// the traversal/classification unification is meant to satisfy: one shared
// classification layer means a source that matches Babel in one mode cannot
// silently diverge in another.
//
// Same ratchet protocol as parity.test.js, with expectations under
// parity/expected-cross/<mode>/<id>.diff:
//
// - ABSENT expectation file: the compilers agree (or both reject the input,
//   which is parity too) and must stay that way.
// - PRESENT expectation file: a known divergence, locked in. Any change
//   fails until regenerated and reviewed.
//
// Regenerate intentionally with:
//
//   UPDATE_PARITY=1 pnpm exec vitest run __tests__/cross-mode-parity.test.js
//
// Some Babel outputs are not even parseable JS (babel-plugin prints raw
// newlines into universal-mode string props); those record a normalize-error
// marker instead of a diff. Never hand-edit expectation files.

const fs = require("fs");
const path = require("path");
const {
  modes,
  fixtureNames,
  readFixtureSource,
  compileBabel,
  compileOxc,
  normalize,
  unifiedDiff
} = require("./parity/harness");

const expectedDir = path.join(__dirname, "parity", "expected-cross");
const update = process.env.UPDATE_PARITY === "1";

// The union of fixture sources, deduplicated by content (several mode
// directories carry identical fixtures). Ids stay stable as fixtures evolve:
// <fixtureDir>--<fixture>, keyed to the first directory that defines the
// content.
function fixtureUnion() {
  const byContent = new Map();
  const union = [];
  for (const mode of Object.keys(modes)) {
    const { fixtureDir } = modes[mode];
    for (const fixture of fixtureNames(mode)) {
      const source = readFixtureSource(mode, fixture);
      if (byContent.has(source)) continue;
      byContent.set(source, true);
      union.push({
        id: `${fixtureDir.replace(/__/g, "")}--${fixture}`,
        fixtureDir,
        source
      });
    }
  }
  return union.sort((a, b) => (a.id < b.id ? -1 : 1));
}

const union = fixtureUnion();

// Compares one union source under one mode's options. Returns "" at parity,
// otherwise a stable divergence record.
function crossDiff(mode, entry) {
  const { options } = modes[mode];
  let babelRaw, babelError;
  try {
    babelRaw = compileBabel(entry.source, options);
  } catch (err) {
    babelError = err;
  }
  let oxcRaw, oxcError;
  try {
    oxcRaw = compileOxc(entry.source, entry.id, options);
  } catch (err) {
    oxcError = err;
  }
  // Both compilers rejecting the input is parity (e.g. cross-renderer
  // nesting in dynamic mode).
  if (babelError && oxcError) return "";
  if (babelError) return `!! babel error: ${babelError.message.split("\n")[0]}\n`;
  if (oxcError) return `!! oxc error: ${oxcError.message.split("\n")[0]}\n`;
  let babelOut, oxcOut;
  try {
    babelOut = normalize(babelRaw);
  } catch (err) {
    return `!! babel output does not normalize: ${err.message.split("\n")[0]}\n`;
  }
  try {
    oxcOut = normalize(oxcRaw);
  } catch (err) {
    return `!! oxc output does not normalize: ${err.message.split("\n")[0]}\n`;
  }
  return unifiedDiff(babelOut, oxcOut);
}

function expectationPath(mode, id) {
  return path.join(expectedDir, mode, `${id}.diff`);
}

function readExpectation(mode, id) {
  const file = expectationPath(mode, id);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeExpectation(mode, id, diff) {
  const file = expectationPath(mode, id);
  if (diff === "") {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, diff);
}

describe("cross-mode fixture-union parity", () => {
  for (const mode of Object.keys(modes)) {
    // A mode's own fixture directory is already ratcheted by parity.test.js.
    const foreign = union.filter(entry => entry.fixtureDir !== modes[mode].fixtureDir);
    describe(mode, () => {
      it.each(foreign.map(entry => [entry.id, entry]))("%s", (id, entry) => {
        const diff = crossDiff(mode, entry);
        if (update) {
          writeExpectation(mode, id, diff);
          return;
        }
        const expected = readExpectation(mode, id);
        if (diff === expected) return;
        const relative = path.relative(path.resolve(__dirname, "../.."), expectationPath(mode, id));
        if (expected === "") {
          throw new Error(
            `${mode}/${id} was at cross-mode parity with babel-plugin but now diverges ` +
              `(babel = "-", oxc = "+").\n` +
              `If this divergence is intentional, regenerate expectations with ` +
              `UPDATE_PARITY=1 and commit ${relative}.\n\n${diff}`
          );
        }
        if (diff === "") {
          throw new Error(
            `${mode}/${id} reached cross-mode parity with babel-plugin. ` +
              `Regenerate expectations with UPDATE_PARITY=1 to delete ${relative}.`
          );
        }
        throw new Error(
          `${mode}/${id} diverges from babel-plugin differently than the recorded ` +
            `expectation (babel = "-", oxc = "+").\n` +
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
      for (const entry of union) {
        if (entry.fixtureDir === modes[mode].fixtureDir) continue;
        known.add(path.join(mode, `${entry.id}.diff`));
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
