/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * Repro probe: jfb KEYED selection shape under the unified driver.
 */
import { describe, expect, test } from "vitest";
import { createRoot, createStore, flush, For } from "solid-js";
import { enableUnifiedFor } from "@solidjs/web";

enableUnifiedFor();

describe("unified For: selection map binding", () => {
  test("row class updates from a sibling store branch", () => {
    let div!: HTMLDivElement;
    const [state, setState] = createStore<any>({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      selection: {}
    });
    createRoot(() => {
      <div ref={div}>
        <For each={state.rows}>
          {(row: any) => <span class={state.selection[row.id] ? "danger" : ""}>{row.id}</span>}
        </For>
      </div>;
    });
    flush();
    expect(div.innerHTML).toBe(
      '<span class="">1</span><span class="">2</span><span class="">3</span>'
    );
    setState((s: any) => {
      s.selection[2] = true;
    });
    flush();
    expect(div.querySelectorAll(".danger").length).toBe(1);
    expect(div.children[1].className).toBe("danger");
    // move selection
    setState((s: any) => {
      delete s.selection[2];
      s.selection[3] = true;
    });
    flush();
    expect(div.children[1].className).toBe("");
    expect(div.children[2].className).toBe("danger");
  });
});

describe("unified For: bindings survive structural passes", () => {
  test("selection still works after replace + append", () => {
    let div!: HTMLDivElement;
    const [state, setState] = createStore<any>({
      rows: [{ id: 1 }, { id: 2 }],
      selection: {}
    });
    createRoot(() => {
      <div ref={div}>
        <For each={state.rows}>
          {(row: any) => <span class={state.selection[row.id] ? "danger" : ""}>{row.id}</span>}
        </For>
      </div>;
    });
    flush();
    // structural pass 1: full replace
    setState((s: any) => {
      s.rows = [{ id: 10 }, { id: 11 }, { id: 12 }];
    });
    flush();
    expect(div.textContent).toBe("101112");
    // structural pass 2: append
    setState((s: any) => {
      s.rows.push({ id: 13 });
    });
    flush();
    expect(div.textContent).toBe("10111213");
    // NOW select — bindings on survivors must still be live.
    setState((s: any) => {
      s.selection[11] = true;
    });
    flush();
    expect(div.querySelectorAll(".danger").length).toBe(1);
    expect(div.children[1].className).toBe("danger");
  });
});
