/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { createRoot, createSignal } from "../../src";
import { insert, Index } from "../src";

describe("Testing an only child each control flow", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal([n1, n2, n3, n4]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()}>{item => <>{item()}</>}</Index>
    </div>
  );

  function apply(array: string[]) {
    setList(array);
    expect(div.innerHTML).toBe(array.join(""));
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("abcd");
  }

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("abcd");
  });

  test("1 missing", () => {
    apply([n2, n3, n4]);
    apply([n1, n3, n4]);
    apply([n1, n2, n4]);
    apply([n1, n2, n3]);
  });

  test("2 missing", () => {
    apply([n3, n4]);
    apply([n2, n4]);
    apply([n2, n3]);
    apply([n1, n4]);
    apply([n1, n3]);
    apply([n1, n2]);
  });

  test("3 missing", () => {
    apply([n1]);
    apply([n2]);
    apply([n3]);
    apply([n4]);
  });

  test("all missing", () => {
    apply([]);
  });

  test("swaps", () => {
    apply([n2, n1, n3, n4]);
    apply([n3, n2, n1, n4]);
    apply([n4, n2, n3, n1]);
  });

  test("rotations", () => {
    apply([n2, n3, n4, n1]);
    apply([n3, n4, n1, n2]);
    apply([n4, n1, n2, n3]);
  });

  test("reversal", () => {
    apply([n4, n3, n2, n1]);
  });

  test("full replace", () => {
    apply(["e", "f", "g", "h"]);
  });

  test("swap backward edge", () => {
    setList(["milk", "bread", "chips", "cookie", "honey"]);
    setList(["chips", "bread", "cookie", "milk", "honey"]);
  });

  test("dispose", () => disposer());
});

describe("Testing an multi child each control flow", () => {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode("z"));
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal([n1, n2, n3, n4]);
  const Component = () => <Index each={list()}>{item => <>{item()}</>}</Index>;
  let disposer: () => void;

  function apply(array: string[]) {
    setList(array);
    expect(div.innerHTML).toBe(`${array.join("")}z`);
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("abcdz");
  }

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      insert(div, <Component />, div.firstChild);
    });

    expect(div.innerHTML).toBe("abcdz");
  });

  test("1 missing", () => {
    apply([n2, n3, n4]);
    apply([n1, n3, n4]);
    apply([n1, n2, n4]);
    apply([n1, n2, n3]);
  });

  test("2 missing", () => {
    apply([n3, n4]);
    apply([n2, n4]);
    apply([n2, n3]);
    apply([n1, n4]);
    apply([n1, n3]);
    apply([n1, n2]);
  });

  test("3 missing", () => {
    apply([n1]);
    apply([n2]);
    apply([n3]);
    apply([n4]);
  });

  test("all missing", () => {
    apply([]);
  });

  test("swaps", () => {
    apply([n2, n1, n3, n4]);
    apply([n3, n2, n1, n4]);
    apply([n4, n2, n3, n1]);
  });

  test("rotations", () => {
    apply([n2, n3, n4, n1]);
    apply([n3, n4, n1, n2]);
    apply([n4, n1, n2, n3]);
  });

  test("reversal", () => {
    apply([n4, n3, n2, n1]);
  });

  test("full replace", () => {
    apply(["e", "f", "g", "h"]);
  });

  test("swap backward edge", () => {
    setList(["milk", "bread", "chips", "cookie", "honey"]);
    setList(["chips", "bread", "cookie", "milk", "honey"]);
  });

  test("dispose", () => disposer());
});

describe("Testing an only child each control flow with fragment children", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal([n1, n2, n3, n4]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()}>
        {item => (
          <>
            {item}
            {item}
          </>
        )}
      </Index>
    </div>
  );

  function apply(array: string[]) {
    setList(array);
    expect(div.innerHTML).toBe(array.map(p => `${p}${p}`).join(""));
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("aabbccdd");
  }

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("aabbccdd");
  });

  test("1 missing", () => {
    apply([n2, n3, n4]);
    apply([n1, n3, n4]);
    apply([n1, n2, n4]);
    apply([n1, n2, n3]);
  });

  test("2 missing", () => {
    apply([n3, n4]);
    apply([n2, n4]);
    apply([n2, n3]);
    apply([n1, n4]);
    apply([n1, n3]);
    apply([n1, n2]);
  });

  test("3 missing", () => {
    apply([n1]);
    apply([n2]);
    apply([n3]);
    apply([n4]);
  });

  test("all missing", () => {
    apply([]);
  });

  test("swaps", () => {
    apply([n2, n1, n3, n4]);
    apply([n3, n2, n1, n4]);
    apply([n4, n2, n3, n1]);
  });

  test("rotations", () => {
    apply([n2, n3, n4, n1]);
    apply([n3, n4, n1, n2]);
    apply([n4, n1, n2, n3]);
  });

  test("reversal", () => {
    apply([n4, n3, n2, n1]);
  });

  test("full replace", () => {
    apply(["e", "f", "g", "h"]);
  });

  test("swap backward edge", () => {
    setList(["milk", "bread", "chips", "cookie", "honey"]);
    setList(["chips", "bread", "cookie", "milk", "honey"]);
  });

  test("dispose", () => disposer());
});

describe("Testing an only child each control flow with array children", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal([n1, n2, n3, n4]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()}>
        {item => (
          <>
            {item()}
            {item()}
          </>
        )}
      </Index>
    </div>
  );

  function apply(array: string[]) {
    setList(array);
    expect(div.innerHTML).toBe(array.map(p => `${p}${p}`).join(""));
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("aabbccdd");
  }

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });

    expect(div.innerHTML).toBe("aabbccdd");
  });

  test("1 missing", () => {
    apply([n2, n3, n4]);
    apply([n1, n3, n4]);
    apply([n1, n2, n4]);
    apply([n1, n2, n3]);
  });

  test("2 missing", () => {
    apply([n3, n4]);
    apply([n2, n4]);
    apply([n2, n3]);
    apply([n1, n4]);
    apply([n1, n3]);
    apply([n1, n2]);
  });

  test("3 missing", () => {
    apply([n1]);
    apply([n2]);
    apply([n3]);
    apply([n4]);
  });

  test("all missing", () => {
    apply([]);
  });

  test("swaps", () => {
    apply([n2, n1, n3, n4]);
    apply([n3, n2, n1, n4]);
    apply([n4, n2, n3, n1]);
  });

  test("rotations", () => {
    apply([n2, n3, n4, n1]);
    apply([n3, n4, n1, n2]);
    apply([n4, n1, n2, n3]);
  });

  test("reversal", () => {
    apply([n4, n3, n2, n1]);
  });

  test("full replace", () => {
    apply(["e", "f", "g", "h"]);
  });

  test("swap backward edge", () => {
    setList(["milk", "bread", "chips", "cookie", "honey"]);
    setList(["chips", "bread", "cookie", "milk", "honey"]);
  });

  test("dispose", () => disposer());
});

describe("Testing each control flow with fallback", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal<string[]>([]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()} fallback={"Empty"}>
        {item => <>{item()}</>}
      </Index>
    </div>
  );

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
    expect(div.innerHTML).toBe("Empty");
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("abcd");
    setList([]);
    expect(div.innerHTML).toBe("Empty");
  });

  test("dispose", () => disposer());
});

describe("Testing each that maps to undefined", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal<string[]>([]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()}>{item => undefined}</Index>
    </div>
  );

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
    expect(div.innerHTML).toBe("");
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("");
    setList([]);
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});

describe("Testing each with indexes", () => {
  let div: HTMLDivElement, disposer: () => void;
  const n1 = "a",
    n2 = "b",
    n3 = "c",
    n4 = "d";
  const [list, setList] = createSignal<string[]>([]);
  const Component = () => (
    <div ref={div}>
      <Index each={list()}>{(item, i) => <span>{item() + i}</span>}</Index>
    </div>
  );

  test("Create each control flow", () => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
    expect(div.innerHTML).toBe("");
    setList([n1, n2, n3, n4]);
    expect(div.innerHTML).toBe("<span>a0</span><span>b1</span><span>c2</span><span>d3</span>");
    setList([n2, n3, n4, n1]);
    expect(div.innerHTML).toBe("<span>b0</span><span>c1</span><span>d2</span><span>a3</span>");
    setList([n3, n4, n1]);
    expect(div.innerHTML).toBe("<span>c0</span><span>d1</span><span>a2</span>");
    setList([n3, n2, n4, n1]);
    expect(div.innerHTML).toBe("<span>c0</span><span>b1</span><span>d2</span><span>a3</span>");
    setList([]);
    expect(div.innerHTML).toBe("");
  });

  test("dispose", () => disposer());
});
