// Harness for the `"use server"` directive pass.
//
// The reference for this pass is FROZEN: every fixture carries committed
// `expected.<mode>[.dev].js` files generated one final time from the Babel
// implementation in vite-plugin-solid@c052963e (see fixtures/README.md).
// The directives-parity suite compares the native `transformDirectives`
// output — normalized through the same Babel re-print the live parity
// harness used — against those files; the frozen files are the spec and
// change only deliberately.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const compilerDir = path.resolve(__dirname, "../..");
const { transformDirectives } = require(compilerDir);

// Normalization re-prints through @babel/core; use the sibling package's
// install like the JSX parity harness (no extra devDependency).
const babelPkgDir = path.resolve(compilerDir, "../babel-plugin-jsx");
const babel = createRequire(path.join(babelPkgDir, "package.json"))("@babel/core");

// The compiler is pointed at the frozen runtime ABI:
// registerServerReference / createServerReference from a configurable module.
const RUNTIME = "@solidjs/web/server-functions";
const ROOT = "/project";
const DIRECTIVE = "use server";

// --- Fixtures ----------------------------------------------------------------

const fixtureDir = path.join(__dirname, "fixtures");

function fixtureNames() {
  return fs
    .readdirSync(fixtureDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function fixtureSourceFile(fixture) {
  for (const name of ["code.js", "code.ts", "code.jsx", "code.tsx"]) {
    const file = path.join(fixtureDir, fixture, name);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`No code.{js,ts,jsx,tsx} for directives fixture ${fixture}`);
}

function fixtureId(fixture) {
  const ext = path.extname(fixtureSourceFile(fixture));
  return `${ROOT}/src/${fixture}${ext}`;
}

function readFixture(fixture) {
  return fs.readFileSync(fixtureSourceFile(fixture), "utf8");
}

/// Committed frozen-reference file for a mode/env combination.
function expectedPath(fixture, mode, env) {
  const suffix = env === "development" ? ".dev" : "";
  return path.join(fixtureDir, fixture, `expected.${mode}${suffix}.js`);
}

function readExpected(fixture, mode, env) {
  return fs.readFileSync(expectedPath(fixture, mode, env), "utf8");
}

function readMeta(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, fixture, "meta.json"), "utf8"));
}

// --- Compiling ----------------------------------------------------------------

function compileOxc(fixture, mode, env) {
  const result = transformDirectives(readFixture(fixture), {
    filename: fixtureId(fixture),
    root: ROOT,
    mode,
    env,
    directive: DIRECTIVE,
    register: { kind: "named", name: "registerServerReference", source: RUNTIME },
    create: { kind: "named", name: "createServerReference", source: RUNTIME }
  });
  return { valid: result.valid, code: result.code, functions: result.functions };
}

// --- Normalization --------------------------------------------------------------
//
// The directive transform targets *identical* structure and naming to the
// frozen Babel reference, so normalization only erases printer cosmetics:
// output is re-parsed and re-printed through the Babel generator with
// literal raws stripped. The frozen expected files were normalized the same
// way (with this same @babel/core) at freeze time.

function normalize(code) {
  const t = babel.types;
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    comments: false,
    compact: false,
    plugins: [
      () => ({
        visitor: {
          NumericLiteral(p) {
            p.node.extra = null;
          },
          StringLiteral(p) {
            p.node.extra = null;
          },
          TemplateLiteral(p) {
            for (const quasi of p.node.quasis) {
              const cooked = quasi.value.cooked;
              if (cooked == null) continue;
              quasi.value.raw = cooked
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$\{/g, "\\${");
            }
          },
          ObjectProperty(p) {
            p.node.shorthand = false;
          },
          ImportSpecifier(p) {
            // `import { x }` vs `import { x as x }` print differently for
            // the same binding.
            if (t.isIdentifier(p.node.imported) && p.node.imported.name === p.node.local.name) {
              p.node.local = t.identifier(p.node.local.name);
            }
          }
        }
      })
    ]
  }).code;
}

// Function IDs embedded in compiled output (`hash-count` or
// `hash-count-name` in development).
function extractIds(code) {
  const matches = code.match(/"[0-9a-f]{1,8}-\d+(?:-[A-Za-z0-9_$]+)?"/g) || [];
  return [...new Set(matches.map(entry => entry.slice(1, -1)))].sort();
}

module.exports = {
  fixtureNames,
  readFixture,
  fixtureId,
  readExpected,
  readMeta,
  compileOxc,
  normalize,
  extractIds
};
