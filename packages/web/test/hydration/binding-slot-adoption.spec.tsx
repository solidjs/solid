/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Binding slots (server-components-principles.md §9.2.3) at t=0: the document
// face ran the fill on the server and wrote each position's value beside
// its marker (pinned by test/server/frame-binding-slots.spec.tsx). Adoption
// mounts the occurrence from the `sc:slot:` record — the hydration attach:
// the fill runs on the client with the same args and writes the same
// values (idempotent), and from then on the positions are the client's:
// client state moves them, handlers dispatch, refs fire with the adopted
// elements. (Morphs around owned positions after a later response are
// pinned by test/frames-binding-slots.spec.tsx.)
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";

const settle = () => new Promise(r => setTimeout(r));
const cycle = async () => {
  flush();
  await settle();
  flush();
  await settle();
};

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const FID = "todos/list";

describe("binding-slot adoption at t=0", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    document.body.innerHTML = "";
  });

  test("the fill mounts on the server-written positions and owns them from there on", async () => {
    // The document as the server left it: the fill's t=0 values are already
    // the attributes (todo 2 completed → `completed` class, `checked`), each
    // beside its marker.
    const container = document.createElement("div");
    container.innerHTML =
      `<solid-frame data-fid="${FID}" style="display:contents"><ul>` +
      `<li _key="1" class="todo" _s:class="row#1:done=completed" _s:hidden="row#1:removed">` +
      `<input type="checkbox" _s:checked="row#1:done" _s:on:input="row#1:toggle" _s:ref="row#1:box"><label>a</label></li>` +
      `<li _key="2" class="todo completed" _s:class="row#2:done=completed" _s:hidden="row#2:removed">` +
      `<input type="checkbox" checked _s:checked="row#2:done" _s:on:input="row#2:toggle" _s:ref="row#2:box"><label>b</label></li>` +
      `</ul></solid-frame>`;
    document.body.appendChild(container);
    (globalThis as any)._$HY = {
      events: [],
      completed: new WeakSet(),
      r: {
        [`sc:slot:${FID}:row#1`]: { id: "1", completed: false },
        [`sc:slot:${FID}:row#2`]: { id: "2", completed: true }
      },
      fe() {}
    };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());

    const [toggled, setToggled] = createSignal<string | null>(null);
    const [removed, setRemoved] = createSignal<string | null>(null);
    const events: string[] = [];
    const refs: Element[] = [];
    const runs: string[] = [];
    const List = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(
      () => (
        <List
          row={(p: any) => {
            runs.push(`row:${p.id}`);
            return {
              get done() {
                return toggled() === p.id ? !p.completed : p.completed;
              },
              get removed() {
                return removed() === p.id;
              },
              toggle: () => events.push(`toggle:${p.id}`),
              box: (el: Element) => refs.push(el)
            };
          }}
        />
      ),
      container
    );
    await cycle();

    // The attach: the fill ran once per occurrence with the record's args
    // and found the DOM already saying what it says. Refs fired with the
    // adopted inputs.
    const li1 = container.querySelector('li[_key="1"]') as HTMLLIElement;
    const li2 = container.querySelector('li[_key="2"]') as HTMLLIElement;
    const input1 = li1.querySelector("input") as HTMLInputElement;
    const input2 = li2.querySelector("input") as HTMLInputElement;
    expect(runs).toEqual(["row:1", "row:2"]);
    expect(li2.className).toBe("todo completed");
    expect(input2.checked).toBe(true);
    expect(input1.checked).toBe(false);
    expect(refs).toEqual([input1, input2]);

    // From here the positions are the client's.
    input1.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toEqual(["toggle:1"]);
    setToggled("1");
    flush();
    expect(li1.className).toBe("todo completed");
    expect(input1.checked).toBe(true);
    setRemoved("2");
    flush();
    expect(li2.hidden).toBe(true);
    // The getters moved the positions; the fill itself never re-ran.
    expect(runs).toEqual(["row:1", "row:2"]);
    expect(refs).toEqual([input1, input2]);

    dispose();
    container.remove();
  });
});
