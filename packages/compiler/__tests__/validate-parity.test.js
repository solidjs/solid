// Parity checks for the `validate` option's malformed-HTML warnings.
//
// Babel warns through `console.warn`; Oxc's port warns from Rust directly to
// process stderr, so both compiles run in child processes and the captured
// stderr is compared — both whether a warning fires and its exact content.

const { spawnSync } = require("child_process");
const path = require("path");

const compilerDir = path.resolve(__dirname, "..");

const cases = {
  pInDiv: { code: "const t = <p><div>bad</div></p>;", warns: true },
  nestedA: { code: "const t = <a><a>x</a></a>;", warns: true },
  tableNoTbody: { code: "const t = <table><tr><td>1</td></tr></table>;", warns: true },
  formInForm: { code: "const t = <form><form>x</form></form>;", warns: true },
  buttonInButton: { code: "const t = <button><button>x</button></button>;", warns: true },
  dynamicHole: { code: "const t = <p>{x()}<div>bad</div></p>;", warns: true },
  hydratableMarkers: {
    code: "const t = <p>{x()}<div>bad</div></p>;",
    options: { hydratable: true },
    warns: true
  },
  // Table partials are wrapped in the right context before validation.
  tdPartial: { code: "const t = <td>cell</td>;", warns: false },
  trPartial: { code: "const t = <tr><td>c</td></tr>;", warns: false },
  colPartial: { code: "const t = <col />;", warns: false },
  theadPartial: { code: "const t = <thead><tr><th>h</th></tr></thead>;", warns: false },
  emptyTbody: { code: "const t = <tbody></tbody>;", warns: false },
  // Escaped text must not be re-interpreted as markup.
  scriptEscape: { code: 'const t = <div>{"<script>a();</script>"}<b>ok</b></div>;', warns: false },
  liOrphan: { code: "const t = <li>item</li>;", warns: false },
  goodDiv: { code: "const t = <div><span>fine</span></div>;", warns: false },
  disabled: { code: "const t = <p><div>bad</div></p>;", options: { validate: false }, warns: false }
};

const babelRunner = `
const babel = require("@babel/core");
const plugin = require("../babel-plugin-jsx");
babel.transformSync(process.argv[1], {
  filename: "a.jsx",
  parserOpts: { plugins: ["jsx"] },
  plugins: [[plugin, JSON.parse(process.argv[2])]]
});
`;

const oxcRunner = `
const { transform } = require("./index.js");
transform(process.argv[1], { filename: "a.jsx", ...JSON.parse(process.argv[2]) });
`;

function stderrOf(runner, code, options) {
  const result = spawnSync("node", ["-e", runner, code, JSON.stringify(options)], {
    cwd: compilerDir,
    encoding: "utf8"
  });
  expect(result.status).toBe(0);
  return result.stderr;
}

describe("validate warning parity", () => {
  for (const [name, { code, options = {}, warns }] of Object.entries(cases)) {
    test(name, () => {
      const fullOptions = { moduleName: "r-dom", ...options };
      const babelErr = stderrOf(babelRunner, code, fullOptions);
      const oxcErr = stderrOf(oxcRunner, code, fullOptions);
      expect(babelErr.includes("malformed")).toBe(warns);
      expect(oxcErr.includes("malformed")).toBe(warns);
      if (warns) {
        expect(oxcErr.trim()).toBe(babelErr.trim());
      }
    });
  }
});
