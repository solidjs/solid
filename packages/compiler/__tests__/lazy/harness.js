// Harness for the `lazy()` module-URL pass (transformLazy).
//
// The reference for this pass is FROZEN: every fixture carries a committed
// `expected.js` generated one final time from the Babel implementation in
// vite-plugin-solid (`src/lazy-module-url.ts` at commit 380d2f0), normalized
// through the same Babel re-print used below (see fixtures/README.md). The
// lazy-parity suite compares the native `transformLazy` output — normalized
// the same way — against those files; the frozen files are the spec and
// change only deliberately.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const compilerDir = path.resolve(__dirname, "../..");
const { transformLazy } = require(compilerDir);

// Normalization re-prints through @babel/core; use the sibling package's
// install like the other parity harnesses (no extra devDependency).
const babelPkgDir = path.resolve(compilerDir, "../babel-plugin-jsx");
const babel = createRequire(path.join(babelPkgDir, "package.json"))("@babel/core");

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
  throw new Error(`No code.{js,ts,jsx,tsx} for lazy fixture ${fixture}`);
}

// Relative on purpose: solid-refresh (and this pass's `location` sibling)
// relativize absolute filenames against process.cwd(), which would make
// frozen outputs depend on where the test runner starts. A relative id
// round-trips unchanged.
function fixtureId(fixture) {
  const ext = path.extname(fixtureSourceFile(fixture));
  return `src/${fixture}${ext}`;
}

function readFixture(fixture) {
  return fs.readFileSync(fixtureSourceFile(fixture), "utf8");
}

function readExpected(fixture) {
  return fs.readFileSync(path.join(fixtureDir, fixture, "expected.js"), "utf8");
}

// --- Compiling ----------------------------------------------------------------

function compileOxc(fixture) {
  return transformLazy(readFixture(fixture), { filename: fixtureId(fixture) });
}

// --- Normalization -------------------------------------------------------------
//
// The lazy pass targets *identical* structure to the frozen Babel reference
// (an appended string-literal argument), so normalization only erases
// printer cosmetics: output is re-parsed and re-printed through the Babel
// generator with literal raws stripped. The frozen expected files were
// normalized the same way (with this same @babel/core) at freeze time.

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
          DirectiveLiteral(p) {
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
            if (t.isIdentifier(p.node.imported) && p.node.imported.name === p.node.local.name) {
              p.node.local = t.identifier(p.node.local.name);
            }
          }
        }
      })
    ]
  }).code;
}

module.exports = {
  fixtureNames,
  readFixture,
  fixtureId,
  readExpected,
  compileOxc,
  normalize
};
