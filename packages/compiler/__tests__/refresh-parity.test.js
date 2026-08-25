// Frozen-reference suite for the solid-refresh HMR pass.
//
// Every fixture is compiled with the native `transformRefresh` and the
// normalized output must match the committed `expected.js` byte-for-byte.
// Those files were generated one final time from the actual solid-refresh
// Babel plugin (solid-refresh@0.8.0-next.7) and are now the spec — see
// refresh/fixtures/README.md for how to update them deliberately.
//
// On top of the whole-output comparison, the xxhash32 signature hashes are
// compared explicitly: they are the HMR-stability contract (a diverging
// hash means a spurious component remount on every edit of an unrelated
// part of the file), and bit-exactness only holds while the native
// signature printer reproduces @babel/generator's default print for the
// component expression. The sig-* fixtures are printer torture cases kept
// specifically to lock that guarantee in (statement/expression/JSX/class/
// comment formatting, array-pattern rest commas, exponentiation
// parenthesization, JSX child indentation).

const {
  fixtureNames,
  readExpected,
  compileOxc,
  normalize,
  extractSignatures
} = require("./refresh/harness");

describe("solid-refresh frozen Babel reference", () => {
  for (const fixture of fixtureNames()) {
    describe(fixture, () => {
      it("matches the frozen output", () => {
        const oxc = compileOxc(fixture);
        expect(normalize(oxc.code).trimEnd() + "\n").toBe(readExpected(fixture));
      });

      it("matches the frozen signature hashes bit-exactly", () => {
        const oxc = compileOxc(fixture);
        expect(extractSignatures(oxc.code)).toEqual(extractSignatures(readExpected(fixture)));
      });
    });
  }
});
