/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Binding slots (server-components-principles.md §9.2.3), client face: server
// elements carry `_s:<position>="<occurrence>:<key>[=<name>]"` markers for
// the positions a client fill owns. The occurrence is the slot CALL (one
// data context), so the frame mounts it once — the fill runs once with the
// occurrence's args (live: re-emitted args flow into the same computation)
// — and writes every consuming element's positions from the returned
// object: attributes, class names and style properties by name, text
// between its `<!--_s:t=…-->` pair, handlers and refs read once when an
// element binds.
// The morph keeps the elements (keyed) and reads the same markers off
// incoming markup to skip the client's positions, so a server re-render
// can't strip a client-owned value between the morph and the fill's next
// run. A consumer change alone (an element replaced, a position added)
// rebinds without re-running the fill.
//
// The server side is hand-framed Responses (marker-bearing html and slot
// records, exactly what the server face emits — pinned by
// test/server/frame-binding-slots.spec.tsx) behind a stubbed fetch.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush, Loading, OBSERVE } from "solid-js";
// From the packaged entry, not `../src`: the frames client writes positions
// through `@solidjs/web`'s `assign` (the shared instance an app has), and
// delegated dispatch must find the root registered by the SAME instance.
import { dynamic, render } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";
import { openFrameResponse } from "./lifecycle-matrix/harness.js";

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

const ID = "todos/list";

type Todo = { id: string; title: string; completed: boolean };

// The markup the shared `TodoRow` renders on the server (stream face: markers
// only, no values) — one `row#<id>` occurrence read by three elements.
function rowHtml(t: Todo, extraClass = "") {
  return (
    `<li _key="${t.id}" class="todo${extraClass}" _s:class="row#${t.id}:done=completed" _s:hidden="row#${t.id}:removed">` +
    `<input type="checkbox" _s:checked="row#${t.id}:done" _s:on:input="row#${t.id}:toggle" _s:ref="row#${t.id}:box">` +
    `<label>${t.title}</label>` +
    `<button _s:on:click="row#${t.id}:remove" _s:style="row#${t.id}:opacity=opacity">×</button>` +
    `</li>`
  );
}

function listResponse(version: number, todos: Todo[], extraClass = "") {
  const chunks: any[] = [{ type: "start", id: ID, version }];
  for (const t of todos) {
    chunks.push({
      type: "slot",
      id: ID,
      version,
      key: `row#${t.id}`,
      args: { id: t.id, completed: t.completed }
    });
  }
  chunks.push({
    type: "html",
    id: ID,
    version,
    html: `<ul>${todos.map(t => rowHtml(t, extraClass)).join("")}</ul>`
  });
  chunks.push({ type: "complete", id: ID, version });
  return frameResponse(ID, chunks);
}

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
    resolve: (ref: any) => table.resolve(ref)
  });
}

const getTodos = createServerReference(ID);

describe("binding slots through server-component mounts", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  test("one fill per occurrence writes every consuming element's positions, follows client state and live args through getters, and survives morphs", async () => {
    let todos: Todo[] = [
      { id: "1", title: "a", completed: false },
      { id: "2", title: "b", completed: true }
    ];
    let extraClass = "";
    const [version, setVersion] = createSignal(1);
    vi.stubGlobal("fetch", async () => listResponse(version(), todos, extraClass));

    // Client-side state the fill derives from — the optimistic layer's
    // stand-in: a locally toggled id and a locally removed id.
    const [toggled, setToggled] = createSignal<string | null>(null);
    const [removed, setRemoved] = createSignal<string | null>(null);
    const events: string[] = [];
    const refs: Element[] = [];
    let builds = 0;
    const removedReads: string[] = [];

    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={(p: any) => {
              builds++;
              return {
                get done() {
                  return toggled() === p.id ? !p.completed : p.completed;
                },
                get removed() {
                  removedReads.push(p.id);
                  return removed() === p.id;
                },
                get opacity() {
                  return removed() === p.id ? "0.5" : undefined;
                },
                toggle: () => events.push(`toggle:${p.id}`),
                remove: () => events.push(`remove:${p.id}`),
                box: (el: Element) => refs.push(el)
              };
            }}
          />
        </Loading>
      ),
      container
    );
    await cycle();

    // Mount: the fill ran ONCE per occurrence (not per element) and every
    // position on every consumer took its value — the elements are the
    // server's, the values the client's.
    const li1 = container.querySelector('li[_key="1"]') as HTMLLIElement;
    const li2 = container.querySelector('li[_key="2"]') as HTMLLIElement;
    const input1 = li1.querySelector("input") as HTMLInputElement;
    const input2 = li2.querySelector("input") as HTMLInputElement;
    const button1 = li1.querySelector("button") as HTMLButtonElement;
    expect(builds).toBe(2);
    expect(li1.className).toBe("todo");
    expect(li2.className).toBe("todo completed");
    expect(li1.hidden).toBe(false);
    expect(input1.checked).toBe(false);
    expect(input2.checked).toBe(true);
    expect(refs).toEqual([input1, input2]);

    // Handlers dispatch through the element's binding.
    input1.dispatchEvent(new Event("input", { bubbles: true }));
    button1.click();
    expect(events).toEqual(["toggle:1", "remove:1"]);

    // Client state changes re-read the getters; the fill never re-runs.
    // Handlers stay bound once (one dispatch per event), refs do not re-fire.
    setToggled("1");
    flush();
    expect(li1.className).toBe("todo completed");
    expect(input1.checked).toBe(true);
    expect(li2.className).toBe("todo completed");
    input1.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toEqual(["toggle:1", "remove:1", "toggle:1"]);
    expect(refs).toEqual([input1, input2]);
    setRemoved("2");
    flush();
    expect(li2.hidden).toBe(true);
    expect((li2.querySelector("button") as HTMLElement).style.opacity).toBe("0.5");
    expect(builds).toBe(2);

    // Server re-render (args re-emitted, the server's own class changed):
    // the morph KEEPS the keyed elements and their client-owned positions —
    // `hidden`/`checked` are never stripped, the owned class name rides on
    // top of the server's new class string, the owned style property
    // survives the style attribute's absence — then the changed args flow
    // into the live occurrence: todo 1 is now completed on the server, so
    // the local toggle reads as un-completing it.
    todos = [
      { id: "1", title: "a", completed: true },
      { id: "2", title: "b", completed: true }
    ];
    extraClass = " big";
    setVersion(2);
    await cycle();
    expect(container.querySelector('li[_key="1"]')).toBe(li1);
    expect(container.querySelector('li[_key="2"]')).toBe(li2);
    expect(li1.className).toBe("todo big");
    expect(input1.checked).toBe(false);
    expect(li2.className).toBe("todo big completed");
    expect(li2.hidden).toBe(true);
    expect((li2.querySelector("button") as HTMLElement).style.opacity).toBe("0.5");
    // Live args into the same occurrence: no re-invocation.
    expect(builds).toBe(2);
    expect(refs).toEqual([input1, input2]);
    button1.click();
    expect(events.slice(-1)).toEqual(["remove:1"]);

    // The server drops a row: its occurrence unmounts and the fill's scope
    // disposes with it — later client state changes don't reach it.
    todos = [{ id: "1", title: "a", completed: true }];
    setVersion(3);
    await cycle();
    expect(container.querySelector('li[_key="2"]')).toBeNull();
    expect(container.querySelector('li[_key="1"]')).toBe(li1);
    removedReads.length = 0;
    setRemoved("1");
    flush();
    expect(li1.hidden).toBe(true);
    expect(removedReads.length).toBeGreaterThan(0);
    expect(removedReads.every(id => id === "1")).toBe(true);

    dispose();
    flush();
    container.remove();
  });

  test("a fill runs once, as a component body does: a top-level read is a one-time read dev names, and state created in the body survives", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      listResponse(1, [{ id: "1", title: "a", completed: false }])
    );
    const [hide, setHide] = createSignal(false, { name: "hide" });
    let builds = 0;
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => {
              builds++;
              // A plain value computed in the body: read once, like a
              // component's top-level read.
              const hidden = hide();
              // Local state: lives as long as the occurrence.
              const [done, setDone] = createSignal(false);
              return {
                removed: hidden,
                get done() {
                  return done();
                },
                toggle: () => setDone(d => !d),
                remove: () => {},
                box: () => {}
              };
            }}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector('li[_key="1"]') as HTMLLIElement;
    const input = li.querySelector("input") as HTMLInputElement;
    expect(builds).toBe(1);
    expect(li.hidden).toBe(false);
    const strict = capture.events.filter(e => e.code === "STRICT_READ_UNTRACKED");
    expect(strict).toHaveLength(1);
    expect((strict[0].data as any).strictRead).toContain("`row`");

    // The local signal drives its getter.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(input.checked).toBe(true);
    expect(li.className).toBe("todo completed");

    // The top-level read does not track: the body does not re-run, the
    // plain value stays, and the local state is not recreated.
    setHide(true);
    flush();
    expect(builds).toBe(1);
    expect(li.hidden).toBe(false);
    expect(input.checked).toBe(true);

    capture.stop();
    warn.mockRestore();
    dispose();
    flush();
    container.remove();
  });

  test("a getter's change re-reads the occurrence and writes only the position that moved", async () => {
    vi.stubGlobal("fetch", async () =>
      listResponse(1, [{ id: "1", title: "a", completed: false }])
    );
    const [done, setDone] = createSignal(false);
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              get done() {
                return done();
              },
              removed: false,
              opacity: "0.5",
              toggle: () => {},
              remove: () => {},
              box: () => {}
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector('li[_key="1"]') as HTMLLIElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(r => records.push(...r));
    observer.observe(li, { attributes: true, subtree: true, childList: true });
    setDone(true);
    flush();
    await settle();
    observer.disconnect();
    expect(li.className).toBe("todo completed");
    expect(records.map(r => [(r.target as Element).tagName, r.attributeName])).toEqual([
      ["LI", "class"]
    ]);

    dispose();
    flush();
    container.remove();
  });

  test("handlers bind as client JSX binds them: delegated events dispatch at the root, after a native listener between", async () => {
    vi.stubGlobal("fetch", async () =>
      listResponse(1, [{ id: "1", title: "a", completed: false }])
    );
    const order: string[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              done: false,
              removed: false,
              toggle: () => {},
              remove: (e: MouseEvent) => {
                order.push(`remove:${(e.currentTarget as Element).tagName}`);
              },
              box: () => {}
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const ul = container.querySelector("ul") as HTMLUListElement;
    ul.addEventListener("click", () => order.push("ul"));
    (container.querySelector("button") as HTMLButtonElement).click();
    expect(order).toEqual(["ul", "remove:BUTTON"]);

    dispose();
    flush();
    container.remove();
  });

  test("a consumer change without an args change rebinds the live occurrence: no re-call, new elements and positions take their values", async () => {
    let shape = 1;
    const [version, setVersion] = createSignal(1);
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: version() },
        { type: "slot", id: ID, version: version(), key: "row#0", args: { n: 7 } },
        {
          type: "html",
          id: ID,
          version: version(),
          html:
            shape === 1
              ? `<ul><li _s:data-n="row#0:n">x</li></ul>`
              : // v2: the li is replaced by a div (tag change) and a second
                // consumer appears with a further position.
                `<ul><div _s:data-n="row#0:n" _s:hidden="row#0:hide">x</div><span _s:class="row#0:on=lit">y</span></ul>`
        },
        { type: "complete", id: ID, version: version() }
      ])
    );
    const runs: number[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={(p: any) => {
              runs.push(p.n);
              return { n: String(p.n), hide: true, on: true };
            }}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector("li")!;
    expect(li.getAttribute("data-n")).toBe("7");
    expect(runs).toEqual([7]);

    shape = 2;
    setVersion(2);
    await cycle();
    expect(container.querySelector("li")).toBeNull();
    const div = container.querySelector("div[_s\\:data-n]") as HTMLElement;
    const span = container.querySelector("span") as HTMLElement;
    expect(div.getAttribute("data-n")).toBe("7");
    expect(div.hidden).toBe(true);
    expect(span.className).toBe("lit");
    // The record was unchanged and the occurrence still had a consumer:
    // rebind, not re-call.
    expect(runs).toEqual([7]);

    dispose();
    flush();
    container.remove();
  });

  test("an occurrence's end detaches the listeners it attached: a positional shift dispatches once, a dropped occurrence's handler never fires", async () => {
    // Positional occurrence ids (the documented default): v1 renders rows
    // [a, b] as `row#0`, `row#1`; v2 renders [b] as `row#0`. Un-keyed, the
    // morph KEEPS the first li and re-marks it for `row#0` — so the element
    // `row#1` bound at v1 is gone, while the element `row#0` bound at v1 is
    // now b's. Every listener v1 attached must go with its occurrence, or
    // the kept element carries two and a click on b fires twice (once
    // through the disposed `row#1` fill). v3 renders the same li with no
    // markers at all: the server stopped calling the slot, the element
    // stays, and a click must reach nothing.
    let shape = 1;
    const [version, setVersion] = createSignal(1);
    const rows = () =>
      shape === 1
        ? `<li _s:on:click="row#0:pick">a</li><li _s:on:click="row#1:pick">b</li>`
        : shape === 2
          ? `<li _s:on:click="row#0:pick">b</li>`
          : `<li>b</li>`;
    vi.stubGlobal("fetch", async () => {
      const v = version();
      const chunks: any[] = [{ type: "start", id: ID, version: v }];
      if (shape === 1) {
        chunks.push({ type: "slot", id: ID, version: v, key: "row#0", args: { name: "a" } });
        chunks.push({ type: "slot", id: ID, version: v, key: "row#1", args: { name: "b" } });
      } else if (shape === 2) {
        chunks.push({ type: "slot", id: ID, version: v, key: "row#0", args: { name: "b" } });
      }
      chunks.push({ type: "html", id: ID, version: v, html: `<ul>${rows()}</ul>` });
      chunks.push({ type: "complete", id: ID, version: v });
      return frameResponse(ID, chunks);
    });
    const events: string[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List row={(p: any) => ({ pick: () => events.push(`pick:${p.name}`) })} />
        </Loading>
      ),
      container
    );
    await cycle();
    const [liA, liB] = Array.from(container.querySelectorAll("li"));
    liA.click();
    liB.click();
    expect(events).toEqual(["pick:a", "pick:b"]);

    shape = 2;
    setVersion(2);
    await cycle();
    const lis = Array.from(container.querySelectorAll("li"));
    expect(lis).toHaveLength(1);
    expect(lis[0]).toBe(liA);
    expect(lis[0].textContent).toBe("b");
    liA.click();
    expect(events).toEqual(["pick:a", "pick:b", "pick:b"]);

    shape = 3;
    setVersion(3);
    await cycle();
    expect(container.querySelector("li")).toBe(liA);
    expect(liA.hasAttribute("_s:on:click")).toBe(false);
    liA.click();
    expect(events).toEqual(["pick:a", "pick:b", "pick:b"]);

    dispose();
    flush();
    container.remove();
  });

  test("a rebind that RELEASES value positions leaves the server's own attributes alone; released handlers unbind", async () => {
    // v1: the client owns a class name, a style property and `hidden` on the
    // li, and a click on the button. v2 re-renders the li with only `hidden`
    // bound — `class` and `style` are the server's again, and the morph wrote
    // the server's values. The rebind must not diff the client's PREVIOUS
    // props against the new ones and null what it no longer owns.
    let shape = 1;
    const [version, setVersion] = createSignal(1);
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: version() },
        { type: "slot", id: ID, version: version(), key: "row#a", args: { id: "a" } },
        {
          type: "html",
          id: ID,
          version: version(),
          html:
            shape === 1
              ? `<ul><li _key="a" class="todo" _s:class="row#a:done=completed" style="color:red" _s:style="row#a:op=opacity" _s:hidden="row#a:removed"><button _s:on:click="row#a:pick">x</button></li></ul>`
              : `<ul><li _key="a" class="todo" style="color:red" _s:hidden="row#a:removed"><button>x</button></li></ul>`
        },
        { type: "complete", id: ID, version: version() }
      ])
    );
    const clicks: string[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              done: true,
              op: "0.5",
              removed: false,
              pick: () => clicks.push("pick")
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector('li[_key="a"]') as HTMLLIElement;
    const button = li.querySelector("button") as HTMLButtonElement;
    expect(li.className).toBe("todo completed");
    expect(li.style.color).toBe("red");
    expect(li.style.opacity).toBe("0.5");
    expect(li.hidden).toBe(false);
    button.click();
    expect(clicks).toEqual(["pick"]);

    shape = 2;
    setVersion(2);
    await cycle();
    expect(container.querySelector('li[_key="a"]')).toBe(li);
    // The server's class and style stand; the client's former contributions
    // went with the morph (the positions are no longer marked).
    expect(li.className).toBe("todo");
    expect(li.style.color).toBe("red");
    expect(li.style.opacity).toBe("");
    expect(li.hidden).toBe(false);
    // The released handler no longer dispatches.
    (li.querySelector("button") as HTMLButtonElement).click();
    expect(clicks).toEqual(["pick"]);

    dispose();
    flush();
    container.remove();
  });

  test("two keys bound at ONE ref position fan out, every ref firing; a handler position binds one key, the last", async () => {
    // The server merges duplicate refs on an element into one marker
    // (`_s:ref="row#0:a,row#0:b"`, pinned by the compiler fixtures); the
    // client must honor every entry. Duplicate handlers are last-wins on the
    // server, so a handler marker names one key; given two, the client binds
    // the last, as the server would have.
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "row#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html: `<ul><li _s:ref="row#0:a,row#0:b" _s:on:click="row#0:h1,row#0:h2">x</li></ul>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const log: string[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              a: (el: Element) => log.push("ref:a:" + el.tagName),
              b: (el: Element) => log.push("ref:b:" + el.tagName),
              h1: () => log.push("h1"),
              h2: () => log.push("h2")
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector("li") as HTMLLIElement;
    expect(log).toEqual(["ref:a:LI", "ref:b:LI"]);
    li.click();
    expect(log.slice(2)).toEqual(["h2"]);

    dispose();
    flush();
    container.remove();
  });

  test("a handler position receives tuples, and `this`/currentTarget are the element", async () => {
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "row#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html: `<ul><li _s:on:myevent="row#0:h" _s:on:click="row#0:tuple">x</li></ul>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const log: string[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              h(this: Element, e: Event) {
                log.push(`h:${e.type}:${this.tagName}:${(e.currentTarget as Element).tagName}`);
              },
              tuple: [(data: string, e: Event) => log.push(`tuple:${data}:${e.type}`), "d"]
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector("li") as HTMLLIElement;
    li.dispatchEvent(new Event("myevent"));
    li.click();
    expect(log).toEqual(["h:myevent:LI:LI", "tuple:d:click"]);

    dispose();
    flush();
    container.remove();
  });

  test("a zero-arg occurrence (the prop itself) mounts without a record and binds every element that reads it", async () => {
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        {
          type: "html",
          id: ID,
          version: 1,
          html:
            `<div><pre><button _s:on:click="codeBlock:copy">Copy</button>a</pre>` +
            `<pre><button _s:on:click="codeBlock:copy">Copy</button>b</pre></div>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const copied: string[] = [];
    const Doc = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <Doc
            codeBlock={() => ({
              copy: (e: Event) =>
                copied.push((e.currentTarget as Element).parentElement!.textContent!)
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const buttons = container.querySelectorAll("button");
    (buttons[0] as HTMLElement).click();
    (buttons[1] as HTMLElement).click();
    expect(copied).toEqual(["Copya", "Copyb"]);

    dispose();
    flush();
    container.remove();
  });

  test("a zero-arg occurrence whose only consumers arrive late — in a revealed segment, then in a live-hole re-emission — binds when they appear", async () => {
    // The chat example's `codeBlock` shape: the reply streams as a segment
    // (fallback first, fragment + reveal later) whose text is a live hole
    // re-emitted as it grows; the copy button — the occurrence's ONLY
    // consumer — is not in the first flush, not in the revealed fragment's
    // first hole state, and appears only when a later hole re-emission
    // morphs it in. The occurrence has no record (zero-arg call), so
    // nothing but consumer discovery can mount it.
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    const copied: string[] = [];
    let fills = 0;
    const Reply = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>outer</span>}>
          <Reply
            codeBlock={() => {
              fills++;
              return {
                copy: (e: Event) =>
                  copied.push((e.currentTarget as Element).previousElementSibling!.textContent!)
              };
            }}
          />
        </Loading>
      ),
      container
    );
    held.send({ type: "start", id: ID, version: 1 });
    held.send({
      type: "html",
      id: ID,
      version: 1,
      html: '<article><template id="pl-r"></template><span>thinking</span><!--pl-r--></article>'
    });
    await cycle();
    expect(container.textContent).toContain("thinking");
    expect(fills).toBe(0);

    // The segment reveals with its hole in a state that has no consumer yet.
    held.send({
      type: "fragment",
      id: ID,
      version: 1,
      key: "r",
      html: '<div class="msg"><!--lh:0--><p>hi</p><!--lh:/0--></div>'
    });
    held.send({ type: "reveal", id: ID, version: 1, keys: ["r"], waitForStyles: false });
    await cycle();
    expect(container.querySelector(".msg p")!.textContent).toBe("hi");
    expect(fills).toBe(0);

    // The hole grows: a code block with the copy button — the first consumer.
    held.send({
      type: "hole",
      id: ID,
      version: 1,
      key: "lh:0",
      html: '<p>hi</p><pre><code>x</code><button _s:on:click="codeBlock:copy">Copy</button></pre>'
    });
    await cycle();
    expect(fills).toBe(1);
    const first = container.querySelector("button") as HTMLElement;
    first.click();
    expect(copied).toEqual(["x"]);

    // A second block in a later re-emission: a consumer change, same
    // occurrence, no re-fill; the first button keeps its binding.
    held.send({
      type: "hole",
      id: ID,
      version: 1,
      key: "lh:0",
      html:
        '<p>hi</p><pre><code>x</code><button _s:on:click="codeBlock:copy">Copy</button></pre>' +
        '<pre><code>y</code><button _s:on:click="codeBlock:copy">Copy</button></pre>'
    });
    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    expect(fills).toBe(1);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    (buttons[0] as HTMLElement).click();
    (buttons[1] as HTMLElement).click();
    expect(copied).toEqual(["x", "x", "y"]);

    dispose();
    flush();
    container.remove();
  });

  test("a zero-arg occurrence whose only consumer arrives in a hole re-emitted before its segment reveals binds at the reveal", async () => {
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    const copied: string[] = [];
    const Reply = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>outer</span>}>
          <Reply codeBlock={() => ({ copy: () => copied.push("copy") })} />
        </Loading>
      ),
      container
    );
    held.send({ type: "start", id: ID, version: 1 });
    held.send({
      type: "html",
      id: ID,
      version: 1,
      html: '<article><template id="pl-r"></template><span>thinking</span><!--pl-r--></article>'
    });
    await cycle();
    // The fragment's hole is re-emitted BEFORE the reveal (the fragment is
    // received, not yet in the DOM): the reveal must materialize the latest
    // hole state and bind the consumer it carries.
    held.send({
      type: "fragment",
      id: ID,
      version: 1,
      key: "r",
      html: '<div class="msg"><!--lh:0--><p>hi</p><!--lh:/0--></div>'
    });
    held.send({
      type: "hole",
      id: ID,
      version: 1,
      key: "lh:0",
      html: '<pre><code>x</code><button _s:on:click="codeBlock:copy">Copy</button></pre>'
    });
    await cycle();
    expect(container.querySelector("button")).toBe(null);
    held.send({ type: "reveal", id: ID, version: 1, keys: ["r"], waitForStyles: false });
    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    (container.querySelector("button") as HTMLElement).click();
    expect(copied).toEqual(["copy"]);
    dispose();
    flush();
    container.remove();
  });

  test("an occurrence whose prop the client never passed leaves its positions to the server, and dev names the orphan once", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "missing#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html: `<section><button _s:on:click="missing#0:go" _s:hidden="missing#0:hide">x</button></section>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const Card = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <Card />, container);
    await cycle();
    const btn = container.querySelector("button") as HTMLElement;
    expect(() => btn.click()).not.toThrow();
    expect(btn.hidden).toBe(false);
    // The inert element is otherwise indistinguishable from "nothing
    // happened": one finding per occurrence, however many syncs saw it.
    const orphans = capture.events.filter(
      e => e.code === "BINDING_SLOT_POSITION" && (e.data as any).reason === "orphan"
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].severity).toBe("warn");
    expect(orphans[0].data).toMatchObject({
      why: "fill",
      occurrence: "missing#0",
      elements: [btn]
    });
    expect(orphans[0].message).toContain("no client fill resolves for slot `missing`");
    expect(orphans[0].message).toContain("positions: on:click, hidden");
    expect(
      warn.mock.calls.filter(c => String(c[0]).includes("[BINDING_SLOT_POSITION]")).length
    ).toBe(1);
    capture.stop();
    warn.mockRestore();
    dispose();
    flush();
    container.remove();
  });

  test("a fill returning a DOM node, or a prop that is not a function, is a `fill-shape` finding; nothing binds, the element stays inert", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "node#0", args: {} },
        { type: "slot", id: ID, version: 1, key: "obj#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html:
            `<section><button _s:on:click="node#0:go" _s:hidden="node#0:hidden">x</button>` +
            `<i _s:class="obj#0:cls">y</i></section>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const Card = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    // `node`: content where data was expected — a DOM node is an object,
    // and reading `hidden`/`go` off it would bind the DOM's own properties.
    // `obj`: the fill's output passed where the fill belongs.
    const dispose = render(
      () => <Card node={() => document.createElement("div")} obj={{ cls: "c" }} />,
      container
    );
    await cycle();
    const btn = container.querySelector("button") as HTMLElement;
    expect(() => btn.click()).not.toThrow();
    expect(btn.hidden).toBe(false);
    expect((container.querySelector("i") as HTMLElement).className).toBe("");
    const shapes = capture.events.filter(
      e => e.code === "BINDING_SLOT_POSITION" && (e.data as any).reason === "fill-shape"
    );
    expect(shapes.map(e => e.data)).toEqual([
      { reason: "fill-shape", occurrence: "node#0", shape: "a DOM node" },
      { reason: "fill-shape", occurrence: "obj#0", shape: "object" }
    ]);
    expect(shapes[0].message).toContain("returned a DOM node");
    expect(shapes[1].message).toContain("the client prop is an object, not a function");
    expect(
      warn.mock.calls.filter(c => String(c[0]).includes("[BINDING_SLOT_POSITION]")).length
    ).toBe(2);
    capture.stop();
    warn.mockRestore();
    dispose();
    flush();
    container.remove();
  });

  test("a called occurrence whose args record never arrived is an orphan finding, once, and still mounts", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The protocol out of step: markup marks `row#9` but no `slot` record
    // for it rides the stream (the producer always emits the record ahead
    // of the markup, so this is a dropped record or an id mismatch, never
    // a fill mistake). The bare `codeBlock` occurrence has no record by
    // design and must not report.
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        {
          type: "html",
          id: ID,
          version: 1,
          html:
            `<ul><li _s:hidden="row#9:removed"><input _s:checked="row#9:done"></li></ul>` +
            `<button _s:on:click="codeBlock:copy">Copy</button>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const args: any[] = [];
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <List
          row={(p: any) => {
            args.push({ ...p });
            return { done: true, removed: false };
          }}
          codeBlock={() => ({ copy: () => {} })}
        />
      ),
      container
    );
    await cycle();
    // Second sync (a flush with nothing new) must not report again.
    flush();
    await settle();
    const orphans = capture.events.filter(
      e => e.code === "BINDING_SLOT_POSITION" && (e.data as any).reason === "orphan"
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].data).toMatchObject({ why: "record", occurrence: "row#9" });
    expect((orphans[0].data as any).elements.length).toBe(2);
    expect(orphans[0].message).toContain("no args record for it arrived");
    // Behavior unchanged: the fill mounted with empty args and bound.
    expect(args).toEqual([{}]);
    expect((container.querySelector("input") as HTMLInputElement).checked).toBe(true);
    capture.stop();
    warn.mockRestore();
    dispose();
    flush();
    container.remove();
  });

  test("a fill of getters (the shared-component idiom) runs once; each position tracks its own reads", async () => {
    const todos: Todo[] = [{ id: "1", title: "a", completed: false }];
    vi.stubGlobal("fetch", async () => listResponse(1, todos));
    const [toggled, setToggled] = createSignal(false);
    const [removed, setRemoved] = createSignal(false);
    const events: string[] = [];
    let builds = 0;
    let doneReads = 0;
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={(p: any) => {
              builds++;
              return {
                get done() {
                  doneReads++;
                  return toggled() ? !p.completed : p.completed;
                },
                get removed() {
                  return removed();
                },
                get opacity() {
                  return removed() ? "0.5" : undefined;
                },
                toggle: () => events.push(`toggle:${p.id}`),
                remove: () => events.push(`remove:${p.id}`),
                box: () => {}
              };
            }}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const li = container.querySelector('li[_key="1"]') as HTMLLIElement;
    const input = li.querySelector("input") as HTMLInputElement;
    expect(builds).toBe(1);
    expect(li.className).toBe("todo");
    expect(input.checked).toBe(false);
    // A getter's sources move: the binding re-reads and writes; the fill
    // itself (the object's construction) never re-runs.
    setToggled(true);
    flush();
    expect(builds).toBe(1);
    expect(li.className).toBe("todo completed");
    expect(input.checked).toBe(true);
    setRemoved(true);
    flush();
    expect(builds).toBe(1);
    expect(li.hidden).toBe(true);
    expect((li.querySelector("button") as HTMLElement).style.opacity).toBe("0.5");
    // Handler positions read nothing at bind time: no getter ran for them.
    const reads = doneReads;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toEqual(["toggle:1"]);
    expect(doneReads).toBe(reads);
    dispose();
    flush();
    container.remove();
  });

  test("a TEXT position: the fill writes between the markers, apart from the server's static text; a getter rewrites it; a refetch keeps the client's text", async () => {
    // The stream face: an empty pair per text position, the zero-arg `list`
    // and the called `row#1` beside the server's own text (` items left`,
    // ` left` — the second in the compiler's insert range, as a child among
    // siblings is).
    let tail = " items left";
    const [version, setVersion] = createSignal(1);
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: version() },
        { type: "slot", id: ID, version: version(), key: "row#1", args: { id: "1" } },
        {
          type: "html",
          id: ID,
          version: version(),
          html:
            `<footer><strong><!--_s:t=list:remaining--><!--/_s:t--></strong>${tail}` +
            `<ul><li _key="1"><label><!--_s:t=row#1:title--><!--/_s:t--></label>` +
            `<span><!--$--><!--_s:t=row#1:count--><!--/_s:t--><!--/--> left</span></li></ul></footer>`
        },
        { type: "complete", id: ID, version: version() }
      ])
    );
    const [remaining, setRemaining] = createSignal<unknown>(3);
    const [count, setCount] = createSignal(2);
    let builds = 0;
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            list={() => ({
              get remaining() {
                return remaining();
              }
            })}
            row={() => {
              builds++;
              return {
                title: "Hello <b>",
                get count() {
                  return count();
                }
              };
            }}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const strong = container.querySelector("strong") as HTMLElement;
    const label = container.querySelector("label") as HTMLElement;
    const span = container.querySelector("span") as HTMLElement;
    const footer = container.querySelector("footer") as HTMLElement;
    // Written between the markers, as text (never parsed as markup).
    expect(strong.textContent).toBe("3");
    expect(strong.childNodes).toHaveLength(3);
    expect(label.textContent).toBe("Hello <b>");
    expect(label.children).toHaveLength(0);
    // The value is its own text node; the static text beside it is the server's.
    expect(span.textContent).toBe("2 left");
    const countText = span.childNodes[2] as Text;
    expect(countText.nodeType).toBe(3);
    expect(countText.data).toBe("2");
    expect(footer.textContent).toBe("3 items leftHello <b>2 left");
    const remainingText = strong.childNodes[1] as Text;

    // A getter's sources move: the same text node is rewritten in place.
    setRemaining(2);
    setCount(5);
    flush();
    expect(strong.childNodes[1]).toBe(remainingText);
    expect(remainingText.data).toBe("2");
    expect(countText.data).toBe("5");
    // Numbers render, zero included; nullish and booleans clear.
    setRemaining(0);
    flush();
    expect(strong.textContent).toBe("0");
    setRemaining(null);
    flush();
    expect(strong.textContent).toBe("");
    setRemaining(true);
    flush();
    expect(strong.textContent).toBe("");
    setRemaining(4);
    flush();
    expect(strong.textContent).toBe("4");

    // A refetch re-sends the empty pairs: the morph keeps the client's text
    // (and its node) while the server's own text beside it updates.
    tail = " items to go";
    setVersion(2);
    await cycle();
    expect(container.querySelector("strong")).toBe(strong);
    expect(strong.childNodes[1]).toBe(remainingText);
    expect(strong.textContent).toBe("4");
    expect(span.childNodes[2]).toBe(countText);
    expect(footer.textContent).toBe("4 items to goHello <b>5 left");
    expect(builds).toBe(1);
    setCount(6);
    flush();
    expect(span.textContent).toBe("6 left");

    dispose();
    flush();
    container.remove();
  });

  test("another occurrence taking a TEXT position writes its own value; a position the server releases is the server's again and gets no final write", async () => {
    // Positional ids: v1 renders rows [a, b] as `row#0`, `row#1`; v2 marks
    // the kept first li for `row#1` (another occurrence at the same
    // position); v3 keeps `row#1` alive on the li's `hidden` but releases
    // its text — the server writes the li's content itself.
    let shape = 1;
    const [version, setVersion] = createSignal(1);
    const html = () =>
      shape === 1
        ? `<ul><li><!--_s:t=row#0:title--><!--/_s:t--></li><li><!--_s:t=row#1:title--><!--/_s:t--></li></ul>`
        : shape === 2
          ? `<ul><li><!--_s:t=row#1:title--><!--/_s:t--></li></ul>`
          : `<ul><li _s:hidden="row#1:gone">server text</li></ul>`;
    vi.stubGlobal("fetch", async () => {
      const v = version();
      const chunks: any[] = [{ type: "start", id: ID, version: v }];
      if (shape === 1)
        chunks.push({ type: "slot", id: ID, version: v, key: "row#0", args: { name: "a" } });
      chunks.push({ type: "slot", id: ID, version: v, key: "row#1", args: { name: "b" } });
      chunks.push({ type: "html", id: ID, version: v, html: html() });
      chunks.push({ type: "complete", id: ID, version: v });
      return frameResponse(ID, chunks);
    });
    const [suffix, setSuffix] = createSignal("");
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={(p: any) => ({
              get title() {
                return p.name + suffix();
              },
              gone: false
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const [liA, liB] = Array.from(container.querySelectorAll("li"));
    expect(liA.textContent).toBe("a");
    expect(liB.textContent).toBe("b");

    shape = 2;
    setVersion(2);
    await cycle();
    const lis = Array.from(container.querySelectorAll("li"));
    expect(lis).toEqual([liA]);
    expect(liA.textContent).toBe("b");
    setSuffix("!");
    flush();
    expect(liA.textContent).toBe("b!");

    shape = 3;
    setVersion(3);
    await cycle();
    expect(container.querySelector("li")).toBe(liA);
    expect(liA.textContent).toBe("server text");
    expect(liA.hidden).toBe(false);
    setSuffix("?");
    flush();
    expect(liA.textContent).toBe("server text");

    dispose();
    flush();
    container.remove();
  });

  test("an element binding a handler, an attribute and TEXT from one occurrence is one consumer: a counter button keeps all three", async () => {
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "row#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html: `<p><button _s:aria-pressed="row#0:odd" _s:on:click="row#0:bump"><!--_s:t=row#0:count--><!--/_s:t--></button></p>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const [count, setCount] = createSignal(0);
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              get count() {
                return count();
              },
              get odd() {
                return count() % 2 === 1 ? "true" : "false";
              },
              bump: () => setCount(c => c + 1)
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("0");
    button.click();
    flush();
    expect(button.textContent).toBe("1");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.click();
    flush();
    expect(button.textContent).toBe("2");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    dispose();
    flush();
    container.remove();
  });

  test("a TEXT range the morph re-creates (same element, same key, new markers) rebinds and is written", async () => {
    // v2 moves the server's text from before the pair to after it: the
    // sibling-scoped morph lands the incoming pair as new nodes and removes
    // the old ones, so the consumer is the same element and key at a new
    // start marker — which must count as a change, or the empty new range
    // is never written.
    let shape = 1;
    const [version, setVersion] = createSignal(1);
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: version() },
        { type: "slot", id: ID, version: version(), key: "row#0", args: {} },
        {
          type: "html",
          id: ID,
          version: version(),
          html:
            shape === 1
              ? `<p>by <!--_s:t=row#0:who--><!--/_s:t--></p>`
              : `<p><!--_s:t=row#0:who--><!--/_s:t--> wrote</p>`
        },
        { type: "complete", id: ID, version: version() }
      ])
    );
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List row={() => ({ who: "ada" })} />
        </Loading>
      ),
      container
    );
    await cycle();
    const p = container.querySelector("p") as HTMLElement;
    expect(p.textContent).toBe("by ada");
    shape = 2;
    setVersion(2);
    await cycle();
    expect(container.querySelector("p")).toBe(p);
    expect(p.textContent).toBe("ada wrote");

    dispose();
    flush();
    container.remove();
  });

  test("a non-primitive at a TEXT position is a `text-shape` finding and clears; markup belongs in a template slot", async () => {
    const capture = OBSERVE!.diagnostics.capture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse(ID, [
        { type: "start", id: ID, version: 1 },
        { type: "slot", id: ID, version: 1, key: "row#0", args: {} },
        {
          type: "html",
          id: ID,
          version: 1,
          html:
            `<p><!--_s:t=row#0:obj--><!--/_s:t-->|<!--_s:t=row#0:list--><!--/_s:t-->|` +
            `<!--_s:t=row#0:el--><!--/_s:t-->|<!--_s:t=row#0:fn--><!--/_s:t-->|` +
            `<!--_s:t=row#0:ok--><!--/_s:t--></p>`
        },
        { type: "complete", id: ID, version: 1 }
      ])
    );
    const [obj, setObj] = createSignal<unknown>({ a: 1 });
    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={() => ({
              get obj() {
                return obj();
              },
              list: ["x", "y"],
              el: document.createElement("b"),
              fn: () => "x",
              ok: "ok"
            })}
          />
        </Loading>
      ),
      container
    );
    await cycle();
    const p = container.querySelector("p") as HTMLElement;
    expect(p.textContent).toBe("||||ok");
    expect(p.querySelector("b")).toBeNull();
    const shapes = () =>
      capture.events.filter(
        e => e.code === "BINDING_SLOT_POSITION" && (e.data as any).reason === "text-shape"
      );
    expect(shapes().map(e => e.data)).toEqual([
      { reason: "text-shape", occurrence: "row#0", key: "obj", shape: "object" },
      { reason: "text-shape", occurrence: "row#0", key: "list", shape: "an array" },
      { reason: "text-shape", occurrence: "row#0", key: "el", shape: "a DOM node" },
      { reason: "text-shape", occurrence: "row#0", key: "fn", shape: "function" }
    ]);
    expect(shapes()[0].message).toContain("template slot");
    // Once the value is a primitive it renders.
    setObj("fine");
    flush();
    expect(p.textContent).toBe("fine||||ok");
    capture.stop();
    warn.mockRestore();
    dispose();
    flush();
    container.remove();
  });
});
