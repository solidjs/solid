// Harness for the solid-refresh HMR pass (transformRefresh).
//
// The reference for this pass is FROZEN: every fixture carries a committed
// `expected.js` generated one final time from the actual solid-refresh Babel
// plugin (solid-refresh@0.8.0-next.7, `dist/babel.mjs`), normalized through
// the same Babel re-print used below (see fixtures/README.md). The
// refresh-parity suite compares the native `transformRefresh` output —
// normalized the same way — against those files byte-for-byte, and compares
// the embedded signature hashes explicitly on top of that; the frozen files
// are the spec and change only deliberately.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const compilerDir = path.resolve(__dirname, "../..");
const { transformRefresh } = require(compilerDir);

// Normalization re-prints through @babel/core; use the sibling package's
// install like the other parity harnesses (no extra devDependency).
const babelPkgDir = path.resolve(compilerDir, "../babel-plugin-jsx");
const babel = createRequire(path.join(babelPkgDir, "package.json"))("@babel/core");

// How vite-plugin-solid invokes the plugin; fixtures override via
// options.json (bundler / fixRender / granular — the surface the Babel
// plugin exposes).
const DEFAULT_OPTIONS = { bundler: "vite", fixRender: true, jsx: false };

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
  throw new Error(`No code.{js,ts,jsx,tsx} for refresh fixture ${fixture}`);
}

// Relative on purpose: the plugin computes `location` by relativizing
// absolute filenames against process.cwd(), which would make frozen outputs
// depend on where the test runner starts. A relative id round-trips
// unchanged through both implementations.
function fixtureId(fixture) {
  const ext = path.extname(fixtureSourceFile(fixture));
  return `src/${fixture}${ext}`;
}

function fixtureOptions(fixture) {
  const file = path.join(fixtureDir, fixture, "options.json");
  const overrides = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function readFixture(fixture) {
  return fs.readFileSync(fixtureSourceFile(fixture), "utf8");
}

function readExpected(fixture) {
  return fs.readFileSync(path.join(fixtureDir, fixture, "expected.js"), "utf8");
}

// --- Compiling ----------------------------------------------------------------

function compileOxc(fixture, overrides = {}) {
  return transformRefresh(readFixture(fixture), {
    filename: fixtureId(fixture),
    ...fixtureOptions(fixture),
    ...overrides
  });
}

// --- Normalization -------------------------------------------------------------
//
// The refresh pass targets *identical* structure, naming and hashes to the
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

// The xxhash32 signatures baked into `$$component(..., { signature: "..." })`
// registrations. Compared explicitly (on top of the whole-output comparison)
// because bit-exact hashes are the HMR-stability contract: a diverging hash
// is not a syntax error, just a spurious remount, so it deserves a dedicated
// failure message.
function extractSignatures(code) {
  const matches = [];
  const re = /signature: "([0-9a-f]{1,8})"/g;
  let match;
  while ((match = re.exec(code))) matches.push(match[1]);
  return matches;
}

module.exports = {
  fixtureNames,
  readFixture,
  fixtureId,
  fixtureOptions,
  readExpected,
  compileOxc,
  normalize,
  extractSignatures
};
