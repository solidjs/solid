import { createRoot, createSignal } from "../../src";
import { Show } from "../../src/dom";

describe("Testing an only child show control flow", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5}>{count()}</Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    expect(div.innerHTML).toBe("7");
    setCount(5);
    // direct children are inert, dynamic expression serves to lazy evaluate
    expect(div.innerHTML).toBe("7");
    setCount(2);
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with DOM children", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5}>
        <span>{count}</span>
        <span>counted</span>
      </Show>
    </div>
  );

  test("Create show control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setCount(5);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setCount(2);
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});

describe("Testing an only child show control flow with DOM children and fallback", () => {
  let div: HTMLDivElement, disposer: () => void;
  const [count, setCount] = createSignal(0);
  const Component = () => (
    <div ref={div}>
      <Show when={count() >= 5} fallback={<span>Too Low</span>}>
        <span>{count}</span>
      </Show>
    </div>
  );

  test("Create when control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("<span>Too Low</span>");
  });

  test("Toggle show control flow", () => {
    setCount(7);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("7");
    setCount(5);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("5");
    setCount(2);
    expect((div.firstChild as HTMLSpanElement).innerHTML).toBe("Too Low");
  });

  test("dispose", () => disposer());
});
