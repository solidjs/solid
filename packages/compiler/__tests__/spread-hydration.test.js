const path = require("path");
const { createRequire } = require("module");
const { compileBabel, compileOxc } = require("./parity/harness");

const requireBabel = createRequire(path.resolve(__dirname, "../../babel-plugin/package.json"));
const babel = requireBabel("@babel/core");
const t = babel.types;

const reactiveSource = `
const attrs = () => ({ class: "example" });
const view = <div {...attrs()}><span /></div>;
`;
const staticSource = `
const attrs = { class: "example" };
const view = <div {...attrs}><span /></div>;
`;
const markedStaticSource = `
const attrs = () => ({ class: "example" });
const view = <div {.../* @static */ attrs()}><span /></div>;
`;

const compilers = {
  Babel: (source, options) => compileBabel(source, options),
  native: (source, options) => compileOxc(source, "spread-hydration", options)
};

function inspect(code) {
  const ast = babel.parseSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: "module"
  });
  const helpers = new Map();

  for (const statement of ast.program.body) {
    if (!t.isImportDeclaration(statement)) continue;
    for (const specifier of statement.specifiers) {
      if (t.isImportSpecifier(specifier))
        helpers.set(specifier.imported.name, specifier.local.name);
    }
  }

  return {
    helpers,
    call(name) {
      const local = helpers.get(name);
      const matches = [];
      babel.traverse(ast, {
        CallExpression(callPath) {
          if (t.isIdentifier(callPath.node.callee, { name: local })) matches.push(callPath.node);
        }
      });
      expect(matches, `${name} calls`).toHaveLength(1);
      return matches[0];
    }
  };
}

function returnedExpression(fn) {
  if (!t.isBlockStatement(fn.body)) return fn.body;
  const statement = fn.body.body.find(t.isReturnStatement);
  expect(statement?.argument, "returned expression").toBeDefined();
  return statement.argument;
}

function expectIdentifier(node, name) {
  expect(t.isIdentifier(node, { name })).toBe(true);
}

describe.each(Object.entries(compilers))("%s lone spread hydration", (_name, compile) => {
  test("defers a hydratable reactive SSR merge until after the element key", () => {
    const output = inspect(
      compile(reactiveSource, {
        generate: "ssr",
        hydratable: true,
        moduleName: "r-server"
      })
    );
    const props = output.call("ssrElement").arguments[1];

    expect(t.isArrowFunctionExpression(props)).toBe(true);
    const merged = returnedExpression(props);
    expect(t.isCallExpression(merged)).toBe(true);
    expectIdentifier(merged.callee, output.helpers.get("mergeProps"));
    expect(merged.arguments).toHaveLength(1);
    expectIdentifier(merged.arguments[0], "attrs");
  });

  test("keeps a hydratable static lone spread on the direct path", () => {
    const output = inspect(
      compile(staticSource, {
        generate: "ssr",
        hydratable: true,
        moduleName: "r-server"
      })
    );

    expectIdentifier(output.call("ssrElement").arguments[1], "attrs");
    expect(output.helpers.has("mergeProps")).toBe(false);
  });

  test("keeps a marked-static hydratable lone spread on the direct path", () => {
    const output = inspect(
      compile(markedStaticSource, {
        generate: "ssr",
        hydratable: true,
        moduleName: "r-server"
      })
    );
    const props = output.call("ssrElement").arguments[1];

    expect(t.isCallExpression(props)).toBe(true);
    expectIdentifier(props.callee, "attrs");
    expect(output.helpers.has("mergeProps")).toBe(false);
  });

  test("keeps a non-hydratable reactive lone spread on the direct path", () => {
    const output = inspect(
      compile(reactiveSource, {
        generate: "ssr",
        hydratable: false,
        moduleName: "r-server"
      })
    );
    const props = output.call("ssrElement").arguments[1];

    expect(t.isCallExpression(props)).toBe(true);
    expectIdentifier(props.callee, "attrs");
    expect(output.helpers.has("mergeProps")).toBe(false);
  });

  test("uses the matching merge path in hydratable DOM output", () => {
    const output = inspect(
      compile(reactiveSource, {
        generate: "dom",
        hydratable: true,
        moduleName: "r-dom"
      })
    );
    const props = output.call("spread").arguments[1];

    expect(t.isCallExpression(props)).toBe(true);
    expectIdentifier(props.callee, output.helpers.get("mergeProps"));
    expect(props.arguments).toHaveLength(1);
    expectIdentifier(props.arguments[0], "attrs");
  });
});
