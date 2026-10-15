/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Only a root morph and a reveal change a frame's DOM outside the ranges
// live holes morph, so every other write (a sweep's `ops` unit, a re-sent
// slot record: the bulk of a live stream like the chat example's growing
// reply) has its slot sync reuse the last full walk's result and walk those
// ranges alone, instead of re-walking and re-parsing the binding markers of
// everything the frame shows on every write. These cells pin that the
// scoped sync finds what a full walk would:
// consumers arriving, moving and leaving inside a hole, an occurrence that
// lives only in a hole mounting and unmounting, consumers outside the hole
// untouched — and that the hole writes never walk the whole frame.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, flush, Loading, onCleanup } from "solid-js";
import { dynamic, render } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { prepareTier } from "../frames/src/frame-client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { openFrameResponse } from "./lifecycle-matrix/harness.js";

const ID = "thread/scoped";

beforeAll(() => prepareTier("bind"));

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

const getThread = createServerReference(ID);

const copy = (k: string) => `<button _s:on:click="codeBlock:copy">${k}</button>`;
const share = (k: string) => `<button class="share" _s:on:click="share:go">${k}</button>`;

describe("slot sync after a write that morphs only live holes", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("finds consumers arriving, moving and leaving inside a hole without walking the frame", async () => {
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    const clicked: string[] = [];
    let copyFills = 0;
    let shareFills = 0;
    let shareCleanups = 0;
    const Thread = dynamic(() => getThread() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>wait</span>}>
          <Thread
            codeBlock={() => {
              copyFills++;
              return {
                copy: (e: Event) => clicked.push((e.currentTarget as Element).textContent!)
              };
            }}
            share={() => {
              shareFills++;
              onCleanup(() => shareCleanups++);
              return {
                go: (e: Event) => clicked.push("share:" + (e.currentTarget as Element).textContent)
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
      html: `<article><header>${copy("top")}</header><div class="msg"><!--lh:0--><p>hi</p><!--lh:/0--></div><footer>${copy("end")}</footer></article>`
    });
    await cycle();
    expect(copyFills).toBe(1);

    const walks: Node[] = [];
    const create = document.createTreeWalker.bind(document);
    const spy = vi
      .spyOn(document, "createTreeWalker")
      .mockImplementation((root: Node, ...rest: any[]) => {
        walks.push(root);
        return create(root, ...rest);
      });
    const msg = container.querySelector(".msg")!;
    const hole = (html: string) =>
      held.send({ type: "ops", id: ID, version: 1, ops: [{ type: "hole", key: "lh:0", html }] });
    const click = () => {
      clicked.length = 0;
      container.querySelectorAll("button").forEach(b => (b as HTMLElement).click());
      return clicked.slice();
    };

    // A consumer of the mounted occurrence arrives between the two outside it.
    hole(`<p>hi</p><pre>${copy("x")}</pre>`);
    await cycle();
    expect(click()).toEqual(["top", "x", "end"]);

    // An occurrence that lives only in the hole mounts with its first consumer.
    hole(`<p>hi</p><pre>${copy("x")}</pre>${share("s")}<pre>${copy("y")}</pre>`);
    await cycle();
    expect(click()).toEqual(["top", "x", "share:s", "y", "end"]);
    expect(shareFills).toBe(1);

    // Its consumer leaves: it unmounts; the in-hole copy consumers change.
    hole(`<p>hi</p><pre>${copy("y")}</pre>`);
    await cycle();
    expect(shareCleanups).toBe(1);
    expect(click()).toEqual(["top", "y", "end"]);

    // Back again: a fresh mount.
    hole(`<p>hi</p>${share("t")}`);
    await cycle();
    expect(shareFills).toBe(2);
    expect(click()).toEqual(["top", "share:t", "end"]);

    // A re-sent slot record (a live slot op beside the holes) changes no DOM.
    held.send({ type: "slot", id: ID, version: 1, key: "note#0", args: { n: 1 } });
    held.send({ type: "slot", id: ID, version: 1, key: "note#0", args: { n: 2 } });
    await cycle();
    expect(click()).toEqual(["top", "share:t", "end"]);

    // Every walk those writes ran was over the hole's parent, never the frame.
    expect(walks.length).toBeGreaterThan(0);
    expect(walks.every(root => root === msg)).toBe(true);
    // The occurrence outside the hole never re-filled.
    expect(copyFills).toBe(1);
    spy.mockRestore();

    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    dispose();
    flush();
    container.remove();
  });

  test("a revealed segment whose fills pend lands outside any flush; the next hole write walks the frame and binds what it brought", async () => {
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    const clicked: string[] = [];
    let release!: () => void;
    const ready = new Promise<void>(r => (release = r));
    const Thread = dynamic(() => getThread() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>wait</span>}>
          <Thread
            note={() => {
              const text = createMemo(async () => {
                await ready;
                return "late";
              });
              return <i>{text()}</i>;
            }}
            codeBlock={() => ({
              copy: (e: Event) => clicked.push((e.currentTarget as Element).textContent!)
            })}
          />
        </Loading>
      ),
      container
    );
    held.send({ type: "start", id: ID, version: 1 });
    held.send({ type: "slot", id: ID, version: 1, key: "note#0", args: {} });
    held.send({
      type: "html",
      id: ID,
      version: 1,
      html:
        '<article><template id="pl-r"></template><span>thinking</span><!--pl-r-->' +
        '<div class="msg"><!--lh:0--><p>a</p><!--lh:/0--></div></article>'
    });
    held.send({
      type: "fragment",
      id: ID,
      version: 1,
      key: "r",
      html: `<section><!--slot:note#0:start--><!--slot:note#0:end-->${copy("seg")}</section>`
    });
    held.send({ type: "reveal", id: ID, version: 1, keys: ["r"], waitForStyles: false });
    await cycle();
    // The segment's fill pends: its boundary still shows the fallback.
    expect(container.querySelector("section")).toBe(null);
    const hole = (html: string) =>
      held.send({ type: "ops", id: ID, version: 1, ops: [{ type: "hole", key: "lh:0", html }] });
    hole("<p>b</p>");
    await cycle();

    release();
    await cycle();
    expect(container.querySelector("section i")!.textContent).toBe("late");
    // The content landed with no write: the next hole write finds its consumer.
    hole("<p>c</p>");
    await cycle();
    (container.querySelector("section button") as HTMLElement).click();
    expect(clicked).toEqual(["seg"]);

    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    dispose();
    flush();
    container.remove();
  });

  test("a hole whose parent element is itself a consumer falls back to the full walk and stays exact", async () => {
    const held = openFrameResponse(ID);
    vi.stubGlobal("fetch", async () => held.response);
    const clicked: string[] = [];
    const Thread = dynamic(() => getThread() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>wait</span>}>
          <Thread
            codeBlock={() => ({
              copy: (e: Event) =>
                clicked.push((e.currentTarget as Element).getAttribute("data-k") || "?")
            })}
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
      html: `<div data-k="parent" _s:on:click="codeBlock:copy"><!--lh:0--><span>a</span><!--lh:/0--></div>`
    });
    await cycle();
    const walks: Node[] = [];
    const create = document.createTreeWalker.bind(document);
    const spy = vi
      .spyOn(document, "createTreeWalker")
      .mockImplementation((root: Node, ...rest: any[]) => {
        walks.push(root);
        return create(root, ...rest);
      });
    held.send({
      type: "ops",
      id: ID,
      version: 1,
      ops: [
        {
          type: "hole",
          key: "lh:0",
          html: `<span>a</span><b data-k="child" _s:on:click="codeBlock:copy">c</b>`
        }
      ]
    });
    await cycle();
    spy.mockRestore();
    // The full walk ran (its root holds the hole's parent).
    const parent = container.querySelector('[data-k="parent"]')!;
    expect(walks.some(root => root !== parent && root.contains(parent))).toBe(true);
    clicked.length = 0;
    (container.querySelector("b") as HTMLElement).click();
    // Delegated: the child's handler, then the parent's as it bubbles.
    expect(clicked).toEqual(["child", "parent"]);

    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    dispose();
    flush();
    container.remove();
  });
});
