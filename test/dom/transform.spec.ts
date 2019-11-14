import { createRoot, createSignal } from "../../src";
import { selectWhen, selectEach, awaitSuspense } from "../../src/dom";

function createList(parent: Element, length: number) {
  let i = 0;
  while (i < length) {
    const el: HTMLElement & {model?: number} = document.createElement("div");
    el.model = ++i;
    parent.appendChild(el);
  }
}

describe("selectWhen", () => {
  const div = document.createElement("div"),
    [selected, setSelected] = createSignal(0);
  createList(div, 5);

  test("various selection", () => {
    createRoot(() => {
      const handler = selectWhen(selected, "selected");
      handler(() => [...(div.childNodes as NodeListOf<Element>)]);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("");
      setSelected(2);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("selected");
      expect((div.childNodes[2] as HTMLDivElement).className).toBe("");
      setSelected(3);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("");
      expect((div.childNodes[2] as HTMLDivElement).className).toBe("selected");
    });
  });
});

describe("selectEach", () => {
  const div = document.createElement("div"),
    [selected, setSelected] = createSignal<number[]>([]);
  createList(div, 5);

  test("various selection", () => {
    createRoot(() => {
      const handler = selectEach(selected, "selected");
      handler(() => [...(div.childNodes as NodeListOf<Element>)]);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("");
      setSelected([2]);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("selected");
      expect((div.childNodes[2] as HTMLDivElement).className).toBe("");
      setSelected([3]);
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("");
      expect((div.childNodes[2] as HTMLDivElement).className).toBe("selected");
      setSelected([1, 3]);
      expect((div.childNodes[0] as HTMLDivElement).className).toBe("selected");
      expect((div.childNodes[1] as HTMLDivElement).className).toBe("");
      expect((div.childNodes[2] as HTMLDivElement).className).toBe("selected");
    });
  });
});

describe("awaitSuspense", () => {
  test("test default state", () => {
    createRoot(() => {
      const accessor = () => "Hello";
      expect(awaitSuspense(accessor)()).toBe("Hello");
    });
  });
});
