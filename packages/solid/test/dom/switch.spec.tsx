import { render, Switch, Match } from "../../src/dom";
import { createRoot, createSignal } from "../../src";

describe("Testing a single match switch control flow", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Switch fallback={"fallback"}>
        <Match when={!!count() && count() < 2}>1</Match>
      </Switch>
    </div>
  );

  test("Create Switch control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("fallback");
  });

  test("Toggle Switch control flow", () => {
    setCount(1);
    expect(div.innerHTML).toBe("1");
    setCount(3);
    expect(div.innerHTML).toBe("fallback");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child Switch control flow", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Switch fallback={"fallback"}>
        <Match when={!!count() && count() < 2}>1</Match>
        <Match when={!!count() && count() < 5}>2</Match>
        <Match when={!!count() && count() < 8}>3</Match>
      </Switch>
    </div>
  );

  test("Create Switch control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("fallback");
  });

  test("Toggle Switch control flow", () => {
    setCount(1);
    expect(div.innerHTML).toBe("1");
    setCount(4);
    expect(div.innerHTML).toBe("2");
    setCount(7);
    expect(div.innerHTML).toBe("3");
    setCount(9);
    expect(div.innerHTML).toBe("fallback");
  });

  test("dispose", () => disposer());
});

describe("Testing function handler Switch control flow", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [a, setA] = createSignal(0),
    [b, setB] = createSignal(0),
    [c, setC] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Switch fallback={"fallback"}>
        <Match when={a()}>{a => a}</Match>
        <Match when={b()}>{b => b}</Match>
        <Match when={c()}>{c => c}</Match>
      </Switch>
    </div>
  );

  test("Create Switch control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("fallback");
  });

  test("Toggle Switch control flow", () => {
    setC(1);
    expect(div.innerHTML).toBe("1");
    setB(2);
    expect(div.innerHTML).toBe("2");
    setA(3);
    expect(div.innerHTML).toBe("3");
    setA(0);
    expect(div.innerHTML).toBe("2");
  });

  test("dispose", () => disposer());
});

describe("Test top level switch control flow", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <Switch fallback={"fallback"}>
      <Match when={!!count() && count() < 2}>1</Match>
    </Switch>
  );

  test("Create when control flow", () => {
    disposer = render(Component, div);

    expect(div.innerHTML).toBe("fallback");
    setCount(1);
    expect(div.innerHTML).toBe("1");
  });

  test("dispose", () => disposer());
});
