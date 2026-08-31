// Parity checks for the `validate` option's malformed-HTML compile errors.
//
// Since #3099 `validate` is a hard compile error in both compilers (the
// emitted walk is guaranteed broken once the browser re-parses the markup
// differently). Both compiles run in child processes; the runners catch the
// thrown error and print its message to stderr so the harness can compare
// whether each compiler fired and that the DOM diff content matches.

const { spawnSync } = require("child_process");
const path = require("path");

const compilerDir = path.resolve(__dirname, "..");

const cases = {
  pInDiv: { code: "const t = <p><div>bad</div></p>;", throws: true },
  nestedA: { code: "const t = <a><a>x</a></a>;", throws: true },
  tableNoTbody: { code: "const t = <table><tr><td>1</td></tr></table>;", throws: true },
  formInForm: { code: "const t = <form><form>x</form></form>;", throws: true },
  buttonInButton: { code: "const t = <button><button>x</button></button>;", throws: true },
  dynamicHole: { code: "const t = <p>{x()}<div>bad</div></p>;", throws: true },
  hydratableMarkers: {
    code: "const t = <p>{x()}<div>bad</div></p>;",
    options: { hydratable: true },
    throws: true
  },
  // Table partials are wrapped in the right context before validation.
  tdPartial: { code: "const t = <td>cell</td>;", throws: false },
  trPartial: { code: "const t = <tr><td>c</td></tr>;", throws: false },
  colPartial: { code: "const t = <col />;", throws: false },
  theadPartial: { code: "const t = <thead><tr><th>h</th></tr></thead>;", throws: false },
  emptyTbody: { code: "const t = <tbody></tbody>;", throws: false },
  // Escaped text must not be re-interpreted as markup.
  scriptEscape: { code: 'const t = <div>{"<script>a();</script>"}<b>ok</b></div>;', throws: false },
  liOrphan: { code: "const t = <li>item</li>;", throws: false },
  goodDiv: { code: "const t = <div><span>fine</span></div>;", throws: false },
  disabled: {
    code: "const t = <p><div>bad</div></p>;",
    options: { validate: false },
    throws: false
  }
};

const babelRunner = `
const babel = require("@babel/core");
const plugin = require("../babel-plugin");
try {
  babel.transformSync(process.argv[1], {
    filename: "a.jsx",
    parserOpts: { plugins: ["jsx"] },
    plugins: [[plugin, JSON.parse(process.argv[2])]]
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 42;
}
`;

const oxcRunner = `
const { transform } = require("./index.js");
try {
  transform(process.argv[1], { filename: "a.jsx", ...JSON.parse(process.argv[2]) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 42;
}
`;

function runCompile(runner, code, options) {
  const result = spawnSync("node", ["-e", runner, code, JSON.stringify(options)], {
    cwd: compilerDir,
    encoding: "utf8"
  });
  expect([0, 42]).toContain(result.status);
  return { threw: result.status === 42, stderr: result.stderr };
}

// The compilers format locations differently (Babel appends a code frame;
// Oxc embeds line:col), so parity is asserted on the DOM diff itself.
function domDiff(stderr) {
  const match = stderr.match(/User HTML:\n[^\n]*\n\s*Browser HTML:\n[^\n]*/);
  expect(match).not.toBeNull();
  return match[0].replace(/\n\s+/g, "\n ");
}

describe("validate error parity", () => {
  for (const [name, { code, options = {}, throws }] of Object.entries(cases)) {
    test(name, () => {
      const fullOptions = { moduleName: "r-dom", ...options };
      const babel = runCompile(babelRunner, code, fullOptions);
      const oxc = runCompile(oxcRunner, code, fullOptions);
      expect(babel.threw).toBe(throws);
      expect(oxc.threw).toBe(throws);
      expect(babel.stderr.includes("malformed")).toBe(throws);
      expect(oxc.stderr.includes("malformed")).toBe(throws);
      if (throws) {
        expect(domDiff(oxc.stderr)).toBe(domDiff(babel.stderr));
      }
    });
  }
});
