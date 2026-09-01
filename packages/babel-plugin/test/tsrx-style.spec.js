const path = require("path");
const babel = require("@babel/core");
const tsrx = require("@tsrx/core");
const plugin = require("../index");

const pluginOptions = {
  moduleName: "r-dom",
  builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
  generate: "dom"
};

async function compile(source, filename = "style-case.tsrx", options = {}) {
  return babel.transformAsync(source, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, { ...pluginOptions, ...options }]],
    filename
  });
}

describe("TSRX scoped styles", () => {
  test("exposes core-rendered CSS metadata and scopes host and dynamic tags", async () => {
    const result = await compile(`export function C({ value, Tag }) @{
  <>
    <style>
      div, span { color: red; }
    </style>
    <div class="static" />
    <span class={value} />
    <Tag />
    <{Tag} />
  </>
}`);

    const hash = result.metadata.cssHash;
    expect(hash).toMatch(/^tsrx-[0-9a-f]+$/);
    expect(result.metadata.css).toContain(`div.${hash}`);
    expect(result.metadata.css).toContain(`span.${hash}`);
    expect(result.code).not.toContain("<style");
    expect(result.code).toContain(`class="static ${hash}"`);
    expect(result.code).toContain(`\${value} ${hash}`);
    expect(result.code).toMatch(/createComponent\(Tag,\s*\{\}\)/);
    expect(result.code).toMatch(
      new RegExp(`createComponent\\(_\\$Dynamic,[\\s\\S]*?"class": "${hash}"`)
    );
  });

  test("returns identical CSS metadata for every Babel renderer", async () => {
    const source = `export const C = () => <>
  <style>.item { color: red; }</style>
  <div class="item" />
</>;`;
    const results = await Promise.all(
      ["dom", "ssr", "universal"].map(generate =>
        compile(source, "renderer-parity.tsrx", { generate })
      )
    );
    const metadata = results.map(result => ({
      css: result.metadata.css,
      cssHash: result.metadata.cssHash
    }));

    expect(metadata[1]).toEqual(metadata[0]);
    expect(metadata[2]).toEqual(metadata[0]);
    for (const result of results) expect(result.code).not.toContain("<style");
  });

  test("keeps concurrent transform metadata isolated and cleans the temporary AST payload", async () => {
    const [styled, plain] = await Promise.all([
      compile(`export const C = () => <><style>.x { color:red }</style><div class="x" /></>;`),
      compile(`export const C = () => <div />;`, "plain.tsrx")
    ]);

    expect(styled.metadata.cssHash).toMatch(/^tsrx-[0-9a-f]+$/);
    expect(styled.metadata.css).toContain(styled.metadata.cssHash);
    expect(plain.metadata.css).toBe("");
    expect(plain.metadata.cssHash).toBeNull();

    const withAst = await babel.transformAsync(
      `export const C = () => <><style>.x { color:red }</style><div class="x" /></>;`,
      {
        babelrc: false,
        configFile: false,
        ast: true,
        code: false,
        plugins: [[plugin, pluginOptions]],
        filename: "ast-cleanup.tsrx"
      }
    );
    expect(withAst.ast.tsrxStyle).toBeUndefined();
    expect(withAst.metadata.cssHash).toMatch(/^tsrx-[0-9a-f]+$/);
  });

  test("matches @tsrx/core pruning, nesting, global, and keyframe bytes", async () => {
    const filename = path.join(__dirname, "style-parity.tsrx");
    const source = `export function C() @{
  <>
    <style>
.used { animation: pulse 1s; & > span { color:red } }
.unused { color:blue }
:global(body) { margin:0 }
@keyframes pulse { to { opacity:0 } }
    </style>
    <div class="used"><span /></div>
  </>
}`;

    const ast = tsrx.parseModule(source, filename);
    tsrx.analyzeTsrx(ast, filename);
    const fragment = ast.body[0].declaration.body.render;
    const style = fragment.children.find(child => child.type === "JSXStyleElement");
    const div = fragment.children.find(child => child.type === "JSXElement");
    const span = div.children.find(child => child.type === "JSXElement");
    const stylesheet = tsrx.getStyleElementStylesheet(style);
    const styleClasses = new Map();
    const topScopedClasses = new Map();
    div.metadata.path = [];
    span.metadata.path = [div];
    tsrx.analyzeCss(stylesheet);
    tsrx.pruneCss(stylesheet, div, styleClasses, topScopedClasses, stylesheet.hash);
    tsrx.pruneCss(stylesheet, span, styleClasses, topScopedClasses, stylesheet.hash);
    const expected = tsrx.renderCssResult([stylesheet]);

    const result = await compile(source, filename);
    expect({
      css: result.metadata.css,
      cssHash: result.metadata.cssHash
    }).toEqual(expected);
    expect(result.metadata.css).toContain("/* (unused) .unused");
    expect(result.metadata.css).toContain("body { margin:0 }");
    expect(result.metadata.css).toContain(`@keyframes ${expected.cssHash}-pulse`);
    expect(result.metadata.css).toContain(`& > span.${expected.cssHash}`);
  });

  test("lowers expression-position styles to class maps", async () => {
    const result = await compile(`export const styles = <style>
  .foo { color: red; }
  div { color: blue; }
</style>;`);
    const hash = result.metadata.cssHash;

    expect(result.code).toContain(`"foo": "${hash} foo"`);
    expect(result.code).not.toContain("<style");
    expect(result.metadata.css).toContain(`.foo.${hash}`);
    expect(result.metadata.css).toContain("/* (unused) ");
  });

  test.each([
    {
      name: "a top-level render statement",
      source: `<style>.top-level-marker { color: red; }</style>`
    },
    {
      name: "a block render statement",
      source: `{ <style>.block-marker { color: red; }</style> }`
    },
    {
      name: "a switch-case render statement",
      source: `switch (value) {
  case 1:
    <style>.switch-marker { color: red; }</style>
}`
    },
    {
      name: "a native element child outside a TSRX render block",
      source: `export const C = () => <div>
  <style>.native-child-marker { color: red; }</style>
</div>;`
    }
  ])("matches the oracle for unowned style in $name", async ({ source }) => {
    const result = await compile(source, "unowned-position.tsrx");

    expect({
      css: result.metadata.css,
      cssHash: result.metadata.cssHash
    }).toEqual(tsrx.renderCssResult([]));
    expect(result.code).toContain("<style>");
    expect(result.code).not.toContain("-marker");
  });

  test("matches the oracle by excluding direct @for body styles from ownership", async () => {
    const result = await compile(`export function C({ items }) @{
  <>
    @for (const item of items) {
      <style>.for-marker { color: red; }</style>
    }
    <div />
  </>
}`);

    expect({
      css: result.metadata.css,
      cssHash: result.metadata.cssHash
    }).toEqual(tsrx.renderCssResult([]));
    expect(result.code).toContain("<style>");
    expect(result.code).not.toContain("for-marker");
  });

  test("matches the oracle by excluding direct @pending styles from ownership", async () => {
    const result = await compile(`export function C() @{
  <>
    @try {
      <div />
    } @pending {
      <style>.pending-marker { color: red; }</style>
    }
  </>
}`);

    expect({
      css: result.metadata.css,
      cssHash: result.metadata.cssHash
    }).toEqual(tsrx.renderCssResult([]));
    expect(result.code).toContain("<style>");
    expect(result.code).not.toContain("pending-marker");
  });

  test.each([
    {
      name: "@if",
      directive: `@if (value) {
  <><style>.owned { color: red; }</style><span /></>
}`
    },
    {
      name: "@switch",
      directive: `@switch (value) {
  @case 1: {
    <><style>.owned { color: red; }</style><span /></>
  }
}`
    },
    {
      name: "@try",
      directive: `@try {
  <><style>.owned { color: red; }</style><span /></>
} @catch (error) {
  <span>{error}</span>
}`
    }
  ])("preserves outer fragment ownership through nested $name blocks", async ({ directive }) => {
    const result = await compile(`export function C({ value }) @{
  <>
    ${directive}
    <div class="owned" />
  </>
}`);
    const hash = result.metadata.cssHash;

    expect(hash).toMatch(/^tsrx-[0-9a-f]+$/);
    expect(result.metadata.css).toContain(`.owned.${hash}`);
    expect(result.code).toContain(`class="owned ${hash}"`);
  });

  test("accepts and ignores refs on expression-position styles like the oracle", async () => {
    const result = await compile(`export const styles = <style ref={sideEffect()}>
  .referenced { color: red; }
</style>;`);
    const hash = result.metadata.cssHash;

    expect(result.code).toContain(`"referenced": "${hash} referenced"`);
    expect(result.code).not.toContain("sideEffect");
    expect(result.metadata.css).toContain(`.referenced.${hash}`);
  });

  test("uses the core style-ref helper before rendering", async () => {
    const result = await compile(`export function C() @{
  let styles;
  <>
    <style ref={styles}>.foo { color: red; }</style>
    <div class="foo" />
  </>
}`);
    const hash = result.metadata.cssHash;

    expect(result.code).toContain(`styles = {\n    "foo": "${hash} foo"\n  };`);
    expect(result.code).toContain(`class="foo ${hash}"`);
  });
});
