/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { createContext, useContext, Show } from "solid-js";
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
