/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { createContext, useContext } from "../../src";
import { render, Show } from "../src";

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

  it("should create context properly", () => {
    expect(ThemeContext.id).toBeDefined();
    expect(ThemeContext.defaultValue).toBe("light");
  });

  it("should work with single provider child", () => {
    const div = document.createElement("div");
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <Component />
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[0].innerHTML).toBe("dark");
  });

  it("should work with single conditional provider child", () => {
    const div = document.createElement("div");
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <CondComponent />
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[0].innerHTML).toBe("dark");
  });

  it("should work with multi provider child", () => {
    const div = document.createElement("div");
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          <Component />
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[1].innerHTML).toBe("dark");
  });

  it("should work with multi conditional provider child", () => {
    const div = document.createElement("div");
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          <CondComponent />
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[1].innerHTML).toBe("dark");
  });

  it("should work with dynamic multi provider child", () => {
    const div = document.createElement("div");
    const child = () => <Component />;
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[1].innerHTML).toBe("dark");
  });

  it("should work with dynamic multi conditional provider child", () => {
    const div = document.createElement("div");
    const child = () => <CondComponent />;
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext.Provider>
      ),
      div
    );
    expect(div.children[1].innerHTML).toBe("dark");
  });

  const ThemeContextWithUndefined = createContext<string | undefined>("light");
  const ComponentWithUndefined = () => {
    const theme = useContext(ThemeContextWithUndefined);
    // ?? 'undefined' will never get reached
    return <div>{theme ?? "undefined"}</div>;
  };

  it("should override when nesting", () => {
    const div = document.createElement("div");
    render(
      () => (
        <>
          <ComponentWithUndefined />
          <ThemeContextWithUndefined.Provider value="dark">
            <ComponentWithUndefined />
            <ThemeContextWithUndefined.Provider value="darker">
              <ComponentWithUndefined />
              <ThemeContextWithUndefined.Provider value={undefined}>
                <ComponentWithUndefined />
              </ThemeContextWithUndefined.Provider>
            </ThemeContextWithUndefined.Provider>
          </ThemeContextWithUndefined.Provider>
        </>
      ),
      div
    );
    expect(div.children[0].innerHTML!).toBe("light");
    expect(div.children[1].innerHTML!).toBe("dark");
    expect(div.children[2].innerHTML!).toBe("darker");
    expect(div.children[3].innerHTML!).toBe("light");
  });

  const ThemeContextWithoutDefault = createContext<string | undefined>();
  const ComponentWithoutDefault = () => {
    const theme = useContext(ThemeContextWithoutDefault);
    return <div>{theme ?? "no-default"}</div>;
  };

  it("should work with no default provided", () => {
    const div = document.createElement("div");
    render(
      () => (
        <>
          <ComponentWithoutDefault />
          <ThemeContextWithoutDefault.Provider value="dark">
            <ComponentWithoutDefault />
            <ThemeContextWithoutDefault.Provider value={undefined}>
              <ComponentWithoutDefault />
            </ThemeContextWithoutDefault.Provider>
          </ThemeContextWithoutDefault.Provider>
        </>
      ),
      div
    );
    expect(div.children[0].innerHTML!).toBe("no-default");
    expect(div.children[1].innerHTML!).toBe("dark");
    expect(div.children[2].innerHTML!).toBe("no-default");
  });
});
