// Frozen-reference suite for the `"use server"` directive pass.
//
// Every fixture is compiled with the native `transformDirectives` in every
// mode/env combination and the normalized output must match the committed
// `expected.<mode>[.dev].js` files byte-for-byte. Those files were generated
// one final time from the Babel reference implementation
// (vite-plugin-solid@c052963e) and are now the spec — see
// directives/fixtures/README.md for how to update them deliberately.

const {
  fixtureNames,
  readExpected,
  readMeta,
  compileOxc,
  normalize,
  extractIds
} = require("./directives/harness");

const matrix = [];
for (const mode of ["server", "client"]) {
  for (const env of ["production", "development"]) {
    matrix.push([mode, env]);
  }
}

describe('"use server" directive frozen Babel reference', () => {
  for (const fixture of fixtureNames()) {
    describe(fixture, () => {
      it.each(matrix)("%s/%s", (mode, env) => {
        const oxc = compileOxc(fixture, mode, env);
        const meta = readMeta(fixture);

        expect(oxc.valid).toBe(meta.valid);
        expect(normalize(oxc.code).trimEnd() + "\n").toBe(readExpected(fixture, mode, env));

        // Every ID baked into the output must be reported in the metadata
        // (the manifest contract). The reverse doesn't hold: an extracted
        // function can consume a counter slot and then have its only
        // reference dead-code-eliminated from the client output.
        if (oxc.valid) {
          const reportedIds = new Set(oxc.functions.map(fn => fn.id));
          for (const id of extractIds(oxc.code)) {
            expect(reportedIds).toContain(id);
          }
        }
      });
    });
  }
});
