/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { createContext, useContext, Show, Errored } from "solid-js";
import { render } from "../src/index.js";

describe("Testing Context", () => {
  const ThemeContext = createContext("light");
  const Component = () => {
    const theme = useContext(ThemeContext);
    return <div>{theme}</div>;
  };
  const CondComponent = () => {
    const theme = useContext(ThemeContext);
    return (
      <Show when={true}>
        <div>{theme}</div>
      </Show>
    );
  };
  const div = document.createElement("div");
  it("should create context properly", () => {
    expect(ThemeContext.id).toBeDefined();
    expect(ThemeContext.defaultValue).toBe("light");
  });

  it("should work with single provider child", () => {
    render(
      () => (
        <ThemeContext value="dark">
          <Component />
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with single conditional provider child", () => {
    render(
      () => (
        <ThemeContext value="dark">
          <CondComponent />
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with multi provider child", () => {
    render(
      () => (
        <ThemeContext value="dark">
          <div>Hi</div>
          <Component />
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with multi conditional provider child", () => {
    render(
      () => (
        <ThemeContext value="dark">
          <div>Hi</div>
          <CondComponent />
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with dynamic multi provider child", () => {
    const child = () => <Component />;
    render(
      () => (
        <ThemeContext value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with dynamic multi conditional provider child", () => {
    const child = () => <CondComponent />;
    render(
      () => (
        <ThemeContext value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });
});

// #4181: `undefined` means "not provided" for context, from the provider side
// too. The dev message says the provider passed `undefined` and points at
// `null` as the explicit empty value; a provided `null` reads back as `null`.
describe("Context provided as undefined (#4181)", () => {
  const Opt = createContext<string | null | undefined>(undefined, { name: "Opt" });
  const Reader = () => <span>{String(useContext(Opt))}</span>;

  it("a Provider passing undefined counts as not provided", () => {
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={err => <p>{(err() as Error).message}</p>}>
          <Opt value={undefined}>
            <Reader />
          </Opt>
        </Errored>
      ),
      div
    );
    expect(div.textContent).toBe(
      'Context "Opt" was provided with `undefined`, which counts as not provided: `undefined` means "no value" for context. To provide an empty value, create the context with a `null` default (`createContext<T | null>(null)`) and pass `null`.'
    );
    dispose();
  });

  it("a Provider passing null provides null", () => {
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Opt value={null}>
          <Reader />
        </Opt>
      ),
      div
    );
    expect(div.textContent).toBe("null");
    dispose();
  });
});
