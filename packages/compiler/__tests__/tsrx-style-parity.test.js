const path = require("path");
const { createRequire } = require("module");

const compilerDir = path.resolve(__dirname, "..");
const babelPackageDir = path.resolve(compilerDir, "../babel-plugin");
const requireBabel = createRequire(path.join(babelPackageDir, "package.json"));
const babel = requireBabel("@babel/core");
const babelPlugin = requireBabel(babelPackageDir);
const tsrxCore = requireBabel("@tsrx/core");
const { transform } = require(compilerDir);
const { normalize } = require("./parity/harness");

const options = {
  moduleName: "r-dom",
  builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
  generate: "dom",
  wrapConditionals: true,
  contextToCustomElements: true,
  requireImportSource: false
};

const coreStyleOracle = tsrxCore.createJsxTransform({
  name: "TSRX style oracle",
  imports: {
    suspense: "@tsrx/oracle/suspense",
    errorBoundary: "@tsrx/oracle/error-boundary"
  },
  jsx: {
    rewriteClassAttr: false,
    multiRefStrategy: "array"
  },
  validation: {
    requireUseServerForAwait: false
  }
});

function compareCoreStyleMetadata(source, basename) {
  const filename = path.join(__dirname, basename);
  const ast = tsrxCore.parseModule(source, filename);
  tsrxCore.analyzeTsrx(ast, filename);
  const oracle = coreStyleOracle(ast, source, filename);
  const native = transform(source, { ...options, filename });
  expect({ css: native.css, cssHash: native.cssHash }).toEqual({
    css: oracle.css,
    cssHash: oracle.cssHash
  });
  return { native, oracle };
}

function compareStyleMetadata(source, basename = "style-parity.tsrx") {
  const filename = path.join(__dirname, basename);
  const babelResult = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    plugins: [[babelPlugin, options]],
    filename
  });
  const nativeResult = transform(source, { ...options, filename });
  expect({
    css: nativeResult.css,
    cssHash: nativeResult.cssHash
  }).toEqual({
    css: babelResult.metadata.css,
    cssHash: babelResult.metadata.cssHash
  });
  expect(normalize(nativeResult.code)).toBe(normalize(babelResult.code));
  return nativeResult;
}

describe("native TSRX scoped-style integration", () => {
  test("matches core CSS bytes and scopes static, dynamic, and dynamic-tag classes", () => {
    const result = compareStyleMetadata(`export function C({ value, Tag }) @{
  <>
    <style>
.used { animation: pulse 1s }
.unused { color:blue }
section { display:block }
:global(body) { margin:0 }
@keyframes pulse { to { opacity:0 } }
    </style>
    <div class="used"><span /></div>
    <p class={value} />
    <Tag />
    <{Tag} />
  </>
}`);
    const hash = result.cssHash;

    expect(hash).toMatch(/^tsrx-[0-9a-f]{8}$/);
    expect(result.code).not.toContain("<style");
    expect(result.code).toContain(`used ${hash}`);
    expect(result.code).toContain(`\${value} ${hash}`);
    expect(result.code).toMatch(new RegExp(`class: "${hash}"`));
    expect(result.css).toContain(`@keyframes ${hash}-pulse`);
  });

  test("emits class maps, style refs, and document-ordered metadata", () => {
    const expression = compareStyleMetadata(
      `export const first = <style>.first { color:red }</style>;
export const second = <style>.second { color:blue }</style>;`,
      "style-expression-order.tsrx"
    );
    const [firstHash, secondHash] = expression.cssHash.split(" ");
    expect(expression.code).toContain(`"first": "${firstHash} first"`);
    expect(expression.code).toContain(`"second": "${secondHash} second"`);
    expect(expression.css.indexOf(firstHash)).toBeLessThan(expression.css.indexOf(secondHash));

    const ref = compareStyleMetadata(
      `export function C() @{
  let styles;
  <>
    <style ref={styles}>.foo { color:red }</style>
    <div class="foo" />
  </>
}`,
      "style-ref.tsrx"
    );
    expect(ref.code).toContain(`styles = { "foo": "${ref.cssHash} foo" };`);

    compareStyleMetadata(
      `const marker = "🚀"; export const unicode = <style>.unicode { color:red }</style>;`,
      "unicode-style-location.tsrx"
    );
  });

  test("exposes CSS fields only for TSRX routes and rejects duplicate runtime styles", () => {
    const empty = transform("export const view = <div />;", {
      ...options,
      filename: "empty.tsrx"
    });
    expect(empty.css).toBe("");
    expect(empty.cssHash).toBeNull();

    const jsx = transform("export const view = <div />;", {
      ...options,
      filename: "plain.tsx"
    });
    expect(jsx.css).toBeUndefined();
    expect(jsx.cssHash).toBeUndefined();

    expect(() =>
      transform("const view = <><style>.a{}</style><style>.b{}</style></>;", {
        ...options,
        filename: "duplicate.tsrx"
      })
    ).toThrow(/TSRX fragments can only have one style tag/);
  });

  test("matches core for control-flow pruning and whole-owner annotation", () => {
    const { native, oracle } = compareCoreStyleMetadata(
      `const Component = props => props.children;
export const View = ({ visible, items, Tag }) => <>
  <style>span { color:red }</style>
  @if (visible) { <span /> }
  @for (const item of items) { <i /> }
  <{Tag} />
  <Component><strong /></Component>
</>;`,
      "control-flow-style-oracle.tsrx"
    );
    expect(native.css).toContain(`span.${native.cssHash}`);
    expect(native.css).not.toContain("/* (unused) span");
    for (const tag of ["span", "i"]) {
      expect(native.code).toContain(`<${tag} class=${native.cssHash}>`);
      expect(oracle.code).toContain(`<${tag} class="${native.cssHash}"`);
    }
    expect(native.code).toMatch(new RegExp(`class: "${native.cssHash}"`));
    expect(oracle.code).toContain(`class="${native.cssHash}"`);
    expect(native.code).toContain(`<strong class=${native.cssHash}>`);
    expect(oracle.code).toContain(`<Component><strong class="${native.cssHash}" /></Component>`);
  });

  test("matches core collection boundaries for for and try pending", () => {
    const outer = compareCoreStyleMetadata(
      `export const View = ({ items }) => <>
  <style>.outer { color:red }</style>
  @for (const item of items) { <><style>.loop { color:blue }</style><b /></> }
  @try { <u /> } @pending { <><style>.pending { color:green }</style><em /></> }
</>;`,
      "style-owner-boundaries-oracle.tsrx"
    );
    expect(outer.native.css).toContain(".outer");
    expect(outer.native.css).not.toContain(".loop");
    expect(outer.native.css).not.toContain(".pending");

    for (const [basename, source] of [
      [
        "for-style-boundary-oracle.tsrx",
        `export const view = ({ items }) =>
          @for (const item of items) { <><style>.loop { color:red }</style><b /></> };`
      ],
      [
        "pending-style-boundary-oracle.tsrx",
        `export const view = () =>
          @try { <u /> } @pending { <><style>.pending { color:red }</style><i /></> };`
      ]
    ]) {
      const { native } = compareCoreStyleMetadata(source, basename);
      expect(native.css).toBe("");
      expect(native.cssHash).toBeNull();
    }
  });

  test("matches core style-ref pruning and all supported ref forms", () => {
    const { native } = compareCoreStyleMetadata(
      `let styles;
const holder = {};
const callback = value => value;
const getRef = () => ({ current: null });
export const view = <>
  <style ref={[styles, holder.value, value => callback(value), { current: null }, getRef()]}>.foo { color:red } div { color:blue }</style>
  <div />
</>;`,
      "style-ref-pruning-oracle.tsrx"
    );
    expect(native.css).toContain(`.foo.${native.cssHash}`);
    expect(native.css).not.toContain("/* (unused) .foo");
    expect(native.code).toContain(`"foo": "${native.cssHash} foo"`);
    expect(native.code).toContain("styles = {");
    expect(native.code).toContain("holder.value = {");
    expect(native.code).toContain("callback(value)");
    expect(native.code.match(/_tsrx_style_ref_/g).length).toBeGreaterThanOrEqual(2);
  });

  test("matches core expression classification, ignored refs, and visitor order", () => {
    const unowned = compareCoreStyleMetadata(
      `<style>.orphan { color:red }</style>;`,
      "unowned-style-oracle.tsrx"
    );
    expect(unowned.native.css).toBe("");
    expect(unowned.native.cssHash).toBeNull();

    const expression = compareCoreStyleMetadata(
      `const ignored = () => {};
export const styles = <style ref={ignored}>.foo { color:red }</style>;`,
      "expression-ref-oracle.tsrx"
    );
    expect(expression.native.code).toContain(`"foo": "${expression.native.cssHash} foo"`);

    const ordered = compareCoreStyleMetadata(
      `export function View() @{
  const early = <style>.early { color:red }</style>;
  <>
    <style>.owner { color:blue }</style>
    <div />
  </>
}`,
      "style-owner-order-oracle.tsrx"
    );
    expect(ordered.native.css.indexOf(".owner")).toBeLessThan(ordered.native.css.indexOf(".early"));
  });

  test("preserves authored skip output and safely omits TSRX source maps", () => {
    const source = 'export const view = <><style>.x { color:red }</style><div class="x" /></>;';
    const filename = path.join(__dirname, "style-import-source-skip.tsrx");
    const skipped = transform(source, {
      ...options,
      filename,
      requireImportSource: "solid-js",
      sourceMap: true
    });
    expect(skipped.code).toBe(source);
    expect(skipped.css).toContain(".x.");
    expect(skipped.cssHash).toMatch(/^tsrx-/);
    expect(skipped.map).toBeNull();

    const mapped = transform(source, {
      ...options,
      filename,
      sourceMap: true
    });
    expect(mapped.map).toBeNull();
    expect(
      transform("export const view = <div />;", {
        ...options,
        filename: "mapped.tsx",
        sourceMap: true
      }).map
    ).not.toBeNull();
  });
});
