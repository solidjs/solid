import { render, clearDelegatedEvents } from "../../dist/dom/index";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.firstChild.innerHTML).toBe("Hi");
    expect(testMount.firstChild.host).toBe(div);
  });

  test("dispose", () => disposer());
});

describe("Testing a Portal with Synthetic Events", () => {
  let div = document.createElement("div"),
    disposer,
    testElem,
    clicked = false;
  const Component = () => (
    <Portal>
      <div ref={testElem} onClick={e => (clicked = true)} />
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
  });

  test("Test portal element clicked", () => {
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(true);
    clicked = false;
    clearDelegatedEvents();
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(false);
  });

  test("dispose", () => disposer());
});
