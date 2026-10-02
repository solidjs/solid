/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A region's new markup is part of the transition that asked for it, as a
// navigation's is: when the same write also starts other async work, the
// markup must not land before that work does. Otherwise the page shows half
// a result — the region's answer beside stale siblings, intent marks and
// optimistic values that release only at the commit.
//
// Three ways a showing region changes inside an action:
//   refetch       — the write re-asks the same call (same address);
//   switch        — the write changes the call's arguments (a new address);
//   single-flight — the mutation answers with the region and seeds the
//                   integration's cache with the call's reference.
import { afterEach, describe, expect, test, vi } from "vitest";
import { action, createMemo, createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import {
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  flightCodec
} from "../frames/src/frame-transport.js";
import { createServerReference } from "../server-functions/src/client.js";
import {
  ChunkReader,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  serializeStream,
  subscribeFlightData
} from "../server-functions/src/shared.js";
import { makeHost, frameResponse, openFrameResponse, pump } from "./lifecycle-matrix/harness.js";

const LIST = "morph-tx/list";
const region = (version: number, text: string, id = LIST) => [
  { type: "start", id, version },
  { type: "html", id, version, html: `<p>${text}</p>` },
  { type: "complete", id, version }
];

/** A flight reference as the server's transform serializes one. */
function flightReference(id: string, address: string) {
  const reference: any = () => undefined;
  reference[SERVER_COMPONENT] = id;
  reference[SERVER_COMPONENT_ADDRESS] = address;
  return reference;
}

/** A held single-flight response: the regions first, then the envelope. */
function openFlightResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: c => void (controller = c) });
  return {
    response: new Response(body, {
      headers: {
        "Content-Type": "application/x-frame-stream",
        "X-Frame-Stream": "",
        [SINGLE_FLIGHT_HEADER]: "true"
      }
    }),
    send: (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk))),
    async outcome(envelope: unknown) {
      const reader = new ChunkReader(serializeStream(envelope, flightCodec(undefined)));
      for (let node = await reader.next(); !node.done; node = await reader.next())
        controller.enqueue(createChunk(JSON.stringify({ type: "outcome", payload: node.value })));
    },
    close: () => controller.close()
  };
}

/** `other` is "a0" until `step` moves, then pending until `release()`. */
function heldSibling(step: () => number) {
  let release!: () => void;
  const other = createRoot(() =>
    createMemo(() => {
      const n = step();
      return n === 0 ? "a0" : new Promise<string>(r => (release = () => r(`a${n}`)));
    })
  );
  return { other, release: () => release() };
}

/** `<b>{other()}</b>` beside the region; `view()` reads both. */
function mount(List: any, other: () => string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = createRoot(d => {
    container.appendChild(
      (
        <div>
          <b>{other()}</b>
          <Loading fallback={<span>fallback</span>}>
            <List />
          </Loading>
        </div>
      ) as Node
    );
    return d;
  });
  return {
    view: () => [
      container.querySelector("b")!.textContent,
      container.querySelector("p")?.textContent
    ],
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

const unsubscribes: (() => void)[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
});

describe("a region's morph commits with its transition", () => {
  test("refetch: the region's answer waits for the other work the write started", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getList = createServerReference(LIST);
    const refetch = openFrameResponse(LIST);
    let fetches = 0;
    vi.stubGlobal("fetch", async () =>
      ++fetches === 1 ? frameResponse(LIST, region(1, "v1")) : refetch.response
    );

    const [tick, setTick] = createSignal(0);
    const list = createRoot(() => createMemo(() => (tick(), getList() as any)));
    const sibling = heldSibling(tick);
    const m = mount(
      dynamic(() => list()),
      sibling.other
    );
    await pump();
    expect(m.view()).toEqual(["a0", "v1"]);

    action(function* () {
      setTick(1);
    })();
    await pump(3);
    expect(fetches).toBe(2);

    for (const chunk of region(2, "v2")) refetch.send(chunk);
    refetch.close();
    await pump(3);
    expect(m.view()).toEqual(["a0", "v1"]);

    sibling.release();
    await pump(3);
    expect(m.view()).toEqual(["a1", "v2"]);
    m.cleanup();
  });

  test("switch: the new call's content waits for the other work the write started", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getList = createServerReference(LIST);
    const second = openFrameResponse(LIST);
    let fetches = 0;
    vi.stubGlobal("fetch", async () =>
      ++fetches === 1 ? frameResponse(LIST, region(1, "page 0")) : second.response
    );

    const [page, setPage] = createSignal(0);
    const list = createRoot(() => createMemo(() => getList(page()) as any));
    const sibling = heldSibling(page);
    const m = mount(
      dynamic(() => list()),
      sibling.other
    );
    await pump();
    expect(m.view()).toEqual(["a0", "page 0"]);

    action(function* () {
      setPage(1);
    })();
    await pump(3);
    expect(fetches).toBe(2);

    for (const chunk of region(1, "page 1")) second.send(chunk);
    second.close();
    await pump(3);
    expect(m.view()).toEqual(["a0", "page 0"]);

    sibling.release();
    await pump(3);
    expect(m.view()).toEqual(["a1", "page 1"]);
    m.cleanup();
  });

  // Single-flight has no reader of its own: the response seeds the
  // integration's cache, which is the commit point for markup exactly as it
  // is for data. So the region lands when — and only when — a JSON value
  // seeded by the same response does.
  test("single-flight: the mutation's region lands with the data the response seeds", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const getList = createServerReference(LIST);
    const mutate = createServerReference("morph-tx/mutate");
    const flight = openFlightResponse();
    let fetches = 0;
    vi.stubGlobal("fetch", async () =>
      ++fetches === 1 ? frameResponse(LIST, region(1, "v1")) : flight.response
    );

    // An integration's cache: the call's value and a JSON value beside it.
    const [cache, setCache] = createSignal<{ list?: unknown; label: string }>({ label: "j0" });
    unsubscribes.push(
      subscribeFlightData((slice: any) => {
        setCache({ list: slice.list, label: slice.label });
      })
    );
    const list = createRoot(() => createMemo(() => (cache().list ?? getList()) as any));
    const m = mount(
      dynamic(() => list()),
      () => cache().label
    );
    await pump();
    expect(m.view()).toEqual(["j0", "v1"]);

    const result = mutate();
    await pump(3);
    expect(fetches).toBe(2);

    for (const chunk of region(1, "v2")) flight.send(chunk);
    await pump(3);
    // The region is in; the data that commits it is not.
    expect(m.view()).toEqual(["j0", "v1"]);

    await flight.outcome({
      value: "ok",
      data: { true: { list: flightReference(LIST, LIST), label: "j1" } }
    });
    flight.close();
    await expect(result).resolves.toBe("ok");
    await pump(3);
    expect(m.view()).toEqual(["j1", "v2"]);
    m.cleanup();
  });
});
