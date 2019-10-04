import { createContext, useContext } from "../../dist";
import { insert } from "../../dist/dom";

describe("Testing Context", () => {
  const ThemeContext = createContext('light');
  const Component = () => {
    const theme = useContext(ThemeContext);
    return <div>{theme}</div>;
  }
  const CondComponent = () => {
    const theme = useContext(ThemeContext);
    return <Show when={true}><div>{theme}</div></Show>;
  }
  const div = document.createElement('div');
  it("should create context properly", () => {
    expect(ThemeContext.id).toBeDefined();
    expect(ThemeContext.defaultValue).toBe('light');
  });

  it("should work with single provider child", () => {
    insert(div, <ThemeContext.Provider value="dark">
      <Component />
    </ThemeContext.Provider>);
    expect(div.firstChild.innerHTML).toBe("dark");
    div.innerHTML = '';
  });

  it("should work with single conditional provider child", () => {
    insert(div, <ThemeContext.Provider value="dark">
      <CondComponent />
    </ThemeContext.Provider>)
    expect(div.firstChild.innerHTML).toBe("dark");
    div.innerHTML = '';
  });

  it("should work with multi provider child", () => {
    insert(div, <ThemeContext.Provider value="dark">
      <div>Hi</div>
      <Component />
    </ThemeContext.Provider>);
    expect(div.firstChild.nextSibling.innerHTML).toBe("dark");
    div.innerHTML = '';
  });

  it("should work with multi conditional provider child", () => {
    insert(div, <ThemeContext.Provider value="dark">
      <div>Hi</div>
      <CondComponent />
    </ThemeContext.Provider>);
    expect(div.firstChild.nextSibling.innerHTML).toBe("dark");
    div.innerHTML = '';
  });

  it("should work with dynamic multi provider child", () => {
    const child = () => <Component />;
    insert(div, <ThemeContext.Provider value="dark">
      <div>Hi</div>
      {( child() )}
    </ThemeContext.Provider>);
    expect(div.firstChild.nextSibling.innerHTML).toBe("dark");
    div.innerHTML = '';
  });

  it("should work with dynamic multi conditional provider child", () => {
    const child = () => <CondComponent />;
    insert(div, <ThemeContext.Provider value="dark">
      <div>Hi</div>
      {( child() )}
    </ThemeContext.Provider>);
    expect(div.firstChild.nextSibling.innerHTML).toBe("dark");
    div.innerHTML = '';
  });
});