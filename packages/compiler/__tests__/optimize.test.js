// The `optimize` option: constant folding, dead-code elimination, and static
// resolution of Solid's control-flow components. The Rust unit tests cover
// the folding rules in depth; these cover the option surface and the shape of
// the generated code a consumer sees.

const { transform } = require("../index");

function compile(code, options = {}) {
  return transform(code, {
    filename: "optimize.jsx",
    moduleName: "r-dom",
    ...options
  }).code;
}

function optimized(code, options = {}) {
  return compile(code, { ...options, optimize: true });
}

describe("optimize option", () => {
  it("is off by default", () => {
    const code = compile("const view = <Show when={false}><div /></Show>;");
    expect(code).toContain("_$createComponent");
    expect(code).toContain("Show as _$Show");
  });

  it("rejects a non-boolean value", () => {
    expect(() => compile("const view = <div />;", { optimize: "yes" })).toThrow(
      /`optimize` option must be boolean/
    );
  });

  it("resolves <Show> like an if", () => {
    const taken = optimized("const view = <Show when={true}><div>on</div></Show>;");
    expect(taken).toContain("_$template(`<div>on`)");
    expect(taken).not.toContain("_$createComponent");

    const dropped = optimized("const view = <Show when={false}><div>on</div></Show>;");
    expect(dropped).toContain("const view = null");

    const fallback = optimized(
      "const view = <Show when={0} fallback={<span>off</span>}><div /></Show>;"
    );
    expect(fallback).toContain("<span>off");
    expect(fallback).not.toContain("<div");
  });

  it("resolves <For> over an empty list", () => {
    const empty = optimized(
      "const view = <For each={[]} fallback={<span>none</span>}>{i => <li />}</For>;"
    );
    expect(empty).toContain("<span>none");
    expect(empty).not.toContain("_$createComponent");

    const dynamic = optimized("const view = <For each={items()}>{i => <li />}</For>;");
    expect(dynamic).toContain("_$createComponent");
  });

  it("resolves <Repeat>, <Switch>, and <Dynamic>", () => {
    const repeat = optimized(
      "const view = <Repeat count={0} fallback={<span>none</span>}>{i => <li />}</Repeat>;"
    );
    expect(repeat).toContain("<span>none");

    const branch = optimized(
      "const view = <Switch fallback={<a />}><Match when={false}><b /></Match><Match when={true}><i /></Match></Switch>;"
    );
    expect(branch).toContain("<i");
    expect(branch).not.toContain("<b");

    const dynamic = optimized('const view = <Dynamic component="div" id="main" />;');
    expect(dynamic).toContain("_$template(`<div id=main");
    expect(dynamic).not.toContain("_$createComponent");
  });

  it("folds constants into conditions at any scope", () => {
    const moduleLevel = optimized(
      "const DEBUG = false;\nexport const view = <div><Show when={DEBUG}><b>panel</b></Show></div>;"
    );
    expect(moduleLevel).not.toContain("panel");
    expect(moduleLevel).not.toContain("_$createComponent");

    const local = optimized(
      "export function App() {\n  const DEBUG = false;\n  return <div><Show when={DEBUG}><b>panel</b></Show></div>;\n}"
    );
    expect(local).not.toContain("panel");
    expect(local).not.toContain("_$createComponent");

    const shadowed = optimized(
      "const DEBUG = false;\nexport function App(DEBUG) {\n  return <Show when={DEBUG}><b /></Show>;\n}"
    );
    expect(shadowed).toContain("_$createComponent");
  });

  it("folds constant expressions and drops unreachable statements", () => {
    const attributes = optimized('const view = <div id={"a" + "b"} tabindex={1 + 2} />;');
    expect(attributes).toContain("id=ab");
    expect(attributes).toContain("tabindex=3");

    const dead = optimized("function App() {\n  if (false) missing();\n  return <div />;\n}");
    expect(dead).not.toContain("missing");
  });

  it("only folds a built-in tag that resolves to Solid's component", () => {
    const auto = optimized("const view = <Show when={true}><div /></Show>;");
    expect(auto).not.toContain("_$createComponent");

    const fromSolid = optimized(
      'import { Show } from "solid-js";\nconst view = <Show when={true}><div /></Show>;'
    );
    expect(fromSolid).not.toContain("_$createComponent");

    const fromModuleName = optimized(
      'import { Show } from "r-dom";\nconst view = <Show when={true}><div /></Show>;'
    );
    expect(fromModuleName).not.toContain("_$createComponent");

    const aliased = optimized(
      'import { Show as Cond } from "solid-js";\nconst view = <Cond when={true}><div /></Cond>;'
    );
    expect(aliased).not.toContain("_$createComponent");

    const foreign = optimized(
      'import { Show } from "./my-show";\nconst view = <Show when={true}><div /></Show>;'
    );
    expect(foreign).toContain("_$createComponent");

    const aliasedForeign = optimized(
      'import { Show as Cond } from "./my-show";\nconst view = <Cond when={true}><div /></Cond>;'
    );
    expect(aliasedForeign).toContain("_$createComponent");

    const local = optimized(
      "function App() {\n  const Show = props => props.children;\n  return <Show when={true}><div /></Show>;\n}"
    );
    expect(local).toContain("_$createComponent");
  });

  it("folds the same way in SSR so hydration ids stay aligned", () => {
    const source = "const view = <div><Show when={false}><b /></Show><i /></div>;";
    const ssr = optimized(source, { generate: "ssr", hydratable: true });
    expect(ssr).not.toContain("<b");
    expect(ssr).toContain("<i");
  });
});
