// Frozen-reference suite for the `lazy()` module-URL pass.
//
// Every fixture is compiled with the native `transformLazy` and the
// normalized output must match the committed `expected.js` byte-for-byte.
// Those files were generated one final time from the Babel reference
// implementation (vite-plugin-solid `src/lazy-module-url.ts` at commit
// 380d2f0) and are now the spec — see lazy/fixtures/README.md for how to
// update them deliberately.

const {
  fixtureNames,
  readFixture,
  readExpected,
  compileOxc,
  normalize
} = require("./lazy/harness");

const PLACEHOLDER = "__SOLID_LAZY_MODULE__:";

describe("lazy module-URL frozen Babel reference", () => {
  for (const fixture of fixtureNames()) {
    it(fixture, () => {
      const oxc = compileOxc(fixture);
      expect(normalize(oxc.code).trimEnd() + "\n").toBe(readExpected(fixture));

      // The placeholder format is the wire contract with the bundler
      // plugin's resolveLazyModuleUrls regex: "__SOLID_LAZY_MODULE__:([^"]+)".
      const expectedCount = (readExpected(fixture).match(/__SOLID_LAZY_MODULE__:/g) || []).length;
      const matches = oxc.code.match(/"__SOLID_LAZY_MODULE__:([^"]+)"/g) || [];
      expect(matches).toHaveLength(expectedCount);
      for (const match of matches) {
        expect(match.startsWith(`"${PLACEHOLDER}`)).toBe(true);
      }
    });
  }

  it("returns input unchanged when nothing matches", () => {
    const source = readFixture("no-lazy");
    expect(compileOxc("no-lazy").code).toBe(source);
  });
});
