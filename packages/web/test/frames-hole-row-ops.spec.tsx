/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// solidjs/solid#4064: a live `For` hole's sweep sends only the rows that
// changed. The client morphs just those rows' ranges, appends and truncates
// at the tail, keeps the untouched rows' nodes, and holds a record until
// the wire tier is resident. A range that doesn't show the emission the ops
// were taken against resyncs the live connection, whose resume sends the
// hole whole.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flush, Loading } from "solid-js";
import { dynamic, render } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { prepareTier, tierLoads } from "../frames/src/frame-client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { openFrameResponse } from "./lifecycle-matrix/harness.js";

const ID = "table/rows";

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

const getTable = createServerReference(ID);
const list = (...rows: string[]) => rows.map(r => `<!--lr--><li>${r}</li>`).join("");

async function mount() {
  const held = openFrameResponse(ID);
  vi.stubGlobal("fetch", async () => held.response);
  const Table = dynamic(() => getTable() as any);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <Loading fallback={<span>wait</span>}>
        <Table />
      </Loading>
    ),
    container
  );
  held.send({ type: "start", id: ID, version: 1 });
  held.send({
    type: "html",
    id: ID,
    version: 1,
    html: `<ul><!--lh:0-->${list("a", "b", "c")}<!--lh:/0--></ul>`,
    holes: { "lh:0": "d0" }
  });
  await cycle();
  const items = () => [...container.querySelectorAll("li")];
  const send = (op: any) => held.send({ type: "ops", id: ID, version: 1, ops: [op] });
  const done = async () => {
    held.send({ type: "complete", id: ID, version: 1 });
    held.close();
    await cycle();
    dispose();
    flush();
    container.remove();
  };
  return { container, items, send, held, done };
}

describe("row ops on a live For hole", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("a text hole that empties drops its text node without moving what follows", async () => {
    await prepareTier("wire");
    const { container, items, send, done } = await mount();
    send({
      type: "hole",
      key: "lh:0",
      digest: "d1",
      base: "d0",
      rows: { n: 3, r: [[1, "<li><!--$-->1.5<!--/--><span>q</span></li>"]] }
    });
    await cycle();
    const span = items()[1].querySelector("span")!;
    const added: string[] = [];
    const observer = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) added.push(n.nodeName);
    });
    observer.observe(container, { subtree: true, childList: true });
    send({
      type: "hole",
      key: "lh:0",
      digest: "d2",
      base: "d1",
      rows: { n: 3, r: [[1, "<li><!--$--><!--/--><span>q</span></li>"]] }
    });
    await cycle();
    observer.disconnect();
    expect(items()[1].innerHTML).toBe("<!--$--><!--/--><span>q</span>");
    expect(items()[1].querySelector("span")).toBe(span);
    // Dropping the stale text is the whole change: the span is not re-inserted.
    expect(added).toEqual([]);
    await done();
  });

  test("morphs only the changed row, appends and truncates at the tail", async () => {
    await prepareTier("wire");
    const { items, send, done } = await mount();
    const [a, b, c] = items();

    send({
      type: "hole",
      key: "lh:0",
      digest: "d1",
      base: "d0",
      rows: { n: 3, r: [[1, "<li>B</li>"]] }
    });
    await cycle();
    expect(items().map(li => li.textContent)).toEqual(["a", "B", "c"]);
    // Untouched rows are the same nodes; the changed row was morphed in place.
    expect(items()[0]).toBe(a);
    expect(items()[1]).toBe(b);
    expect(items()[2]).toBe(c);

    // Only the changed row was parsed.
    const parsed: string[] = [];
    const set = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!.set!;
    vi.spyOn(HTMLTemplateElement.prototype, "innerHTML", "set").mockImplementation(function (
      this: any,
      v: string
    ) {
      parsed.push(v);
      set.call(this, v);
    });
    send({
      type: "hole",
      key: "lh:0",
      digest: "d2",
      base: "d1",
      rows: {
        n: 5,
        r: [
          [2, "<li>C</li>"],
          [3, "<li>d</li>"],
          [4, "<li>e</li>"]
        ]
      }
    });
    await cycle();
    expect(parsed).toEqual(["<!--lr--><li>C</li><!--lr--><li>d</li><!--lr--><li>e</li>"]);
    expect(items().map(li => li.textContent)).toEqual(["a", "B", "C", "d", "e"]);
    expect(items()[0]).toBe(a);

    send({
      type: "hole",
      key: "lh:0",
      digest: "d3",
      base: "d2",
      rows: { n: 2, r: [] }
    });
    await cycle();
    expect(items().map(li => li.textContent)).toEqual(["a", "B"]);
    expect(items()[0]).toBe(a);
    await done();
  });

  test("a range that doesn't show the ops' base resyncs the live connection and waits", async () => {
    await prepareTier("wire");
    const load = tierLoads.wire!;
    const real = load.r;
    const cancel = vi.fn();
    load.r = { ...real, cancel };
    try {
      const { items, send, done } = await mount();
      const [a] = items();
      cancel.mockClear();
      // Base names an emission this range never applied.
      send({
        type: "hole",
        key: "lh:0",
        digest: "d2",
        base: "dX",
        rows: { n: 3, r: [[1, "<li>Q</li>"]] }
      });
      await cycle();
      expect(cancel).toHaveBeenCalledWith(expect.anything(), ID);
      expect(items().map(li => li.textContent)).toEqual(["a", "b", "c"]);
      // The resume re-sends the hole whole; it morphs and row ops resume on it.
      send({ type: "hole", key: "lh:0", html: list("a", "y", "c"), digest: "d3" });
      await cycle();
      expect(items().map(li => li.textContent)).toEqual(["a", "y", "c"]);
      send({
        type: "hole",
        key: "lh:0",
        digest: "d4",
        base: "d3",
        rows: { n: 3, r: [[2, "<li>z</li>"]] }
      });
      await cycle();
      expect(items().map(li => li.textContent)).toEqual(["a", "y", "z"]);
      expect(items()[0]).toBe(a);
      expect(cancel).toHaveBeenCalledTimes(1);
      await done();
    } finally {
      load.r = real;
    }
  });

  test("without the wire tier a row op waits for it; one that lands on top of it resyncs", async () => {
    await prepareTier("wire");
    const load = tierLoads.wire!;
    const real = load.r;
    const cancel = vi.fn();
    // A load that hasn't landed.
    tierLoads.wire = new Promise<void>(() => {});
    try {
      const { items, send, held, done } = await mount();
      send({
        type: "hole",
        key: "lh:0",
        digest: "d1",
        base: "d0",
        rows: { n: 3, r: [[1, "<li>B</li>"]] }
      });
      await cycle();
      expect(items().map(li => li.textContent)).toEqual(["a", "b", "c"]);
      // The tier lands (its install re-walks with an empty write): the op applies.
      tierLoads.wire = load;
      load.r = { ...real, cancel };
      held.send({ type: "ops", id: ID, version: 1, ops: [] });
      await cycle();
      expect(items().map(li => li.textContent)).toEqual(["a", "B", "c"]);

      // Two ops while the tier is away: the second names a base never shown.
      tierLoads.wire = new Promise<void>(() => {});
      send({
        type: "hole",
        key: "lh:0",
        digest: "d2",
        base: "d1",
        rows: { n: 3, r: [[0, "<li>A</li>"]] }
      });
      send({
        type: "hole",
        key: "lh:0",
        digest: "d3",
        base: "d2",
        rows: { n: 3, r: [[2, "<li>C</li>"]] }
      });
      await cycle();
      tierLoads.wire = load;
      held.send({ type: "ops", id: ID, version: 1, ops: [] });
      await cycle();
      expect(cancel).toHaveBeenCalledWith(expect.anything(), ID);
      expect(items().map(li => li.textContent)).toEqual(["a", "B", "c"]);
      await done();
    } finally {
      tierLoads.wire = load;
      load.r = real;
    }
  });
});
