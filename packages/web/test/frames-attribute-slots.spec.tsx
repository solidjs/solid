/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Attribute slots (server-components-principles.md §9.2.3), client face: server
// elements carry `_s:<position>="<occurrence>:<key>[=<name>]"` markers for
// the positions a client fill owns. The occurrence is the slot CALL (one
// data context), so the frame mounts it once — the fill runs once with the
// occurrence's args (live: re-emitted args flow into the same computation)
// — and writes every consuming element's positions from the returned
// object: attributes, class names and style properties by name, handlers
// as stable dispatchers reading the latest output, refs once per element.
// The morph keeps the elements (keyed) and reads the same markers off
// incoming markup to skip the client's positions, so a server re-render
// can't strip a client-owned value between the morph and the fill's next
// run. A consumer change alone (an element replaced, a position added)
// rebinds without re-running the fill.
//
// The server side is hand-framed Responses (marker-bearing html and slot
// records, exactly what the server face emits — pinned by
// test/server/frame-attribute-slots.spec.tsx) behind a stubbed fetch.
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

describe("attribute slots through server-component mounts", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  test("one fill per occurrence writes every consuming element's positions, follows client state and live args, and survives morphs", async () => {
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
    const runs: string[] = [];

    const List = dynamic(() => getTodos() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <List
            row={(p: any) => {
              const done = toggled() === p.id ? !p.completed : p.completed;
              runs.push(`row:${p.id}:${done}`);
              return {
                done,
                removed: removed() === p.id,
                opacity: removed() === p.id ? "0.5" : undefined,
                // Fresh closures every run: the binding must not re-add
                // listeners or re-fire refs for them.
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
    expect(runs).toEqual(["row:1:false", "row:2:true"]);
    expect(li1.className).toBe("todo");
    expect(li2.className).toBe("todo completed");
    expect(li1.hidden).toBe(false);
    expect(input1.checked).toBe(false);
    expect(input2.checked).toBe(true);
    expect(refs).toEqual([input1, input2]);

    // Handlers dispatch through delegation to the latest output.
    input1.dispatchEvent(new Event("input", { bubbles: true }));
    button1.click();
    expect(events).toEqual(["toggle:1", "remove:1"]);

    // Client state changes rerun the fill; only the changed positions
    // touch the DOM. Handlers stay bound once (one dispatch per event), refs
    // do not re-fire.
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
    // Live props into the same computation: no re-invocation, one rerun of
    // the fill for the occurrence whose args changed.
    expect(runs.slice(-1)).toEqual(["row:1:false"]);
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
    const before = runs.length;
    setRemoved("1");
    flush();
    expect(li1.hidden).toBe(true);
    expect(runs.slice(before)).toEqual(["row:1:false"]);

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
      e => e.code === "ATTRIBUTE_SLOT_POSITION" && (e.data as any).reason === "orphan"
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
      warn.mock.calls.filter(c => String(c[0]).includes("[ATTRIBUTE_SLOT_POSITION]")).length
    ).toBe(1);
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
      e => e.code === "ATTRIBUTE_SLOT_POSITION" && (e.data as any).reason === "orphan"
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
});
