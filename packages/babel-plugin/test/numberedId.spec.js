const babel = require("@babel/core");
const plugin = require("../index");

function compile(code) {
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [
      [
        plugin,
        {
          moduleName: "r-dom",
          generate: "dom",
          requireImportSource: false
        }
      ]
    ],
    parserOpts: { plugins: ["jsx"] }
  }).code;
}

function parse(code) {
  return babel.parseSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: "module"
  });
}

// Reproduces solidjs/solid#2682: at 222+ merged dynamic attributes on a single
// element, the 222nd generated identifier collides with the reserved word
// `in`, and the emitted object destructuring pattern (`{ ..., in }`) fails to
// parse. A few higher indices also encode to `if` (231) and `do` (489).
test("handles >= 490 merged dynamic attributes without emitting reserved-word bindings", () => {
  const n = 490;
  const attrs = Array.from({ length: n }, (_, i) => `data-a${i}={s${i}()}`).join(" ");
  const src = `const vnode = <div ${attrs} />;`;

  const out = compile(src);

  expect(() => parse(out)).not.toThrow();
});
