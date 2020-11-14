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
  const div = document.createElement("div");
  it("should create context properly", () => {
    expect(ThemeContext.id).toBeDefined();
    expect(ThemeContext.defaultValue).toBe("light");
  });

  it("should work with single provider child", () => {
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <Component />
        </ThemeContext.Provider>
      ),
      div
    );
    expect((div.firstChild as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with single conditional provider child", () => {
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <CondComponent />
        </ThemeContext.Provider>
      ),
      div
    );
    expect((div.firstChild as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with multi provider child", () => {
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          <Component />
        </ThemeContext.Provider>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });

  it("should work with multi conditional provider child", () => {
    render(
      () => (
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          <CondComponent />
        </ThemeContext.Provider>
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
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext.Provider>
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
        <ThemeContext.Provider value="dark">
          <div>Hi</div>
          {child()}
        </ThemeContext.Provider>
      ),
      div
    );
    expect((div.firstChild!.nextSibling! as HTMLDivElement).innerHTML).toBe("dark");
    div.innerHTML = "";
  });
});
