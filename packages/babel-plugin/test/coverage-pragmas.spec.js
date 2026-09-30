const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const plugin = require("../index");
const { expectedFor, pragmasByExport } = require("./__shared_fixtures__/coveragePragmas/expected");

const fixture = fs.readFileSync(
  path.join(__dirname, "__shared_fixtures__", "coveragePragmas", "code.js"),
  "utf8"
);

describe("coverage pragmas", () => {
  test.each(["dom", "ssr", "universal"])(
    "carries authored pragmas onto %s component children getters",
    generate => {
      const { code } = babel.transformSync(fixture, {
        plugins: [[plugin, { generate, moduleName: "r-dom" }]],
        configFile: false,
        babelrc: false,
        filename: "coveragePragmas.jsx"
      });
      expect(pragmasByExport(code)).toEqual(expectedFor(generate));
    }
  );
});
