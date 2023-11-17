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

  const ThemeContextWithoutDefault = createContext<string>();
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
          </ThemeContextWithoutDefault.Provider>
        </>
      ),
      div
    );
    expect(div.children[0].innerHTML!).toBe("no-default");
    expect(div.children[1].innerHTML!).toBe("dark");
  });
});
