import { createRoot, createSignal } from "../../src";
import { select, selectAll, walkDOM } from "../../src/dom";

function createList(parent: Element, length: number, start: number = 0) {
  let i = 0;
  while (i < length) {
    const el: HTMLElement & { model?: number } = document.createElement("div");
    el.model = ++start;
    parent.appendChild(el);
    i++;
  }
}

describe("select", () => {
  const [selected, setSelected] = createSignal(0);

  test("various selection", () => {
    const div = document.createElement("div");
    createList(div, 5);
    createRoot(() => {
      select(selected, "selected")(div);
      expect(div.children[1].className).toBe("");
      setSelected(2);
      expect(div.children[1].className).toBe("selected");
      expect(div.children[2].className).toBe("");
      setSelected(3);
      expect(div.children[1].className).toBe("");
      expect(div.children[2].className).toBe("selected");
    });
  });

  test("deep selection", () => {
    const div = document.createElement("div");
    div.innerHTML = "<div></div><div></div><div></div><div></div><div></div>";
    createList(div.children[0], 5, 0);
    createList(div.children[1], 5, 5);
    createList(div.children[2], 5, 10);
    createList(div.children[3], 5, 15);
    createList(div.children[4], 5, 20);
    setSelected(0);
    createRoot(() => {
      select(selected, "selected", walkDOM(2))(div);
      expect(div.firstElementChild!.children[1].className).toBe("");
      setSelected(2);
      expect(div.firstElementChild!.children[1].className).toBe("selected");
      expect(div.firstElementChild!.children[2].className).toBe("");
      setSelected(10);
      expect(div.firstElementChild!.children[1].className).toBe("");
      expect(div.children[1].children[4].className).toBe("selected");
    });
  });
});

describe("selectAll", () => {
  const [selected, setSelected] = createSignal<number[]>([]);

  test("various selection", () => {
    const div = document.createElement("div");
    createList(div, 5);
    createRoot(() => {
      selectAll(selected, "selected")(div);
      expect(div.children[1].className).toBe("");
      setSelected([2]);
      expect(div.children[1].className).toBe("selected");
      expect(div.children[2].className).toBe("");
      setSelected([3]);
      expect(div.children[1].className).toBe("");
      expect(div.children[2].className).toBe("selected");
      setSelected([1, 3]);
      expect(div.children[0].className).toBe("selected");
      expect(div.children[1].className).toBe("");
      expect(div.children[2].className).toBe("selected");
    });
  });

  test("deep selection", () => {
    const div = document.createElement("div");
    div.innerHTML = "<div></div><div></div><div></div><div></div><div></div>";
    createList(div.children[0], 5, 0);
    createList(div.children[1], 5, 5);
    createList(div.children[2], 5, 10);
    createList(div.children[3], 5, 15);
    createList(div.children[4], 5, 20);
    setSelected([0]);
    createRoot(() => {
      selectAll(selected, "selected", walkDOM(2))(div);
      expect(div.firstElementChild!.children[1].className).toBe("");
      setSelected([2]);
      expect(div.firstElementChild!.children[1].className).toBe("selected");
      expect(div.firstElementChild!.children[2].className).toBe("");
      setSelected([10]);
      expect(div.firstElementChild!.children[1].className).toBe("");
      expect(div.children[1].children[4].className).toBe("selected");
      setSelected([7, 12, 23]);
      expect(div.children[1].children[4].className).toBe("");
      expect(div.children[1].children[1].className).toBe("selected");
      expect(div.children[2].children[1].className).toBe("selected");
      expect(div.children[4].children[2].className).toBe("selected");
    });
  });
});
