/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4140: a consumer of a server component that mounts late — behind a client
// wait, while the frame response is already streaming — must not read the
// frame's landing as work that started when it mounted. The request began
// before the wait resolved, so the two ran in parallel: no ASYNC_WATERFALL.
// The landing promise the mount awaits carries the request's start
// (`OBSERVE.attribution.markFlight`) through the host's landing promise.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, flush, Loading, OBSERVE, Show } from "solid-js";
import type { DiagnosticEvent } from "solid-js";
import { attribution } from "solid-js/attribution";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const getPanel = createServerReference("panel/get");

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

const disposers: Array<() => void> = [];
beforeEach(() => installServerComponents(makeHost()));
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  attribution.disable();
  flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function capture() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const events: DiagnosticEvent[] = [];
  disposers.push(
    OBSERVE!.diagnostics.subscribe(e => {
      if (e.code === "ASYNC_WATERFALL") events.push(e);
    })
  );
  attribution.enable({ log: false, hotRuns: false, hotTime: false });
  return events;
}

/**
 * A frame response whose headers arrive `headerMs` after the request and
 * whose root streams in `renderMs` after the headers.
 */
function stubFrameFetch(renderMs: number, headerMs = 0) {
  vi.stubGlobal("fetch", async () => {
    if (headerMs) await delay(headerMs);
    let controller!: ReadableStreamDefaultController;
    const body = new ReadableStream({ start: c => (controller = c) });
    const send = (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk)));
    send({ type: "start", id: "srv", version: 1 });
    setTimeout(() => {
      send({ type: "html", id: "srv", version: 1, html: "<p>Frame finished</p>" });
      send({ type: "complete", id: "srv", version: 1 });
      controller.close();
    }, renderMs);
    return new Response(body, { headers: { "X-Frame-Stream": "srv" } });
  });
}

async function run(gateMs: number | undefined, callAtMount = false) {
  stubFrameFetch(300, callAtMount ? 80 : 0);
  const events = capture();
  // Acquired outside the reactive graph: the request is in flight (and the
  // server rendering) before anything mounts. `callAtMount` makes the call
  // only once the gated content mounts instead: a real waterfall.
  const reference = callAtMount ? undefined : await getPanel();
  let div!: HTMLDivElement;
  disposers.push(
    createRoot(d => {
      const ready = createMemo(() =>
        gateMs === undefined ? true : delay(gateMs).then(() => true as const)
      );
      // Built when the gated content mounts, so a call it makes starts then.
      const Mount = () => {
        const Panel = dynamic(() => (callAtMount ? getPanel() : reference) as any);
        return <Panel />;
      };
      <div ref={div}>
        <Loading fallback={<i>loading</i>}>
          <Show when={ready()}>
            <Mount />
          </Show>
        </Loading>
      </div>;
      document.body.appendChild(div);
      return () => (d(), div.remove());
    })
  );
  flush();
  for (let i = 0; i < 40 && !div.textContent!.includes("Frame finished"); i++) {
    await delay(20);
    flush();
  }
  expect(div.textContent).toContain("Frame finished");
  return events;
}

describe("late-mounted frame consumers and ASYNC_WATERFALL (#4140)", () => {
  test("control: a consumer mounted at once reports nothing", async () => {
    expect(await run(undefined)).toEqual([]);
  });

  test("a consumer mounted behind a client wait, mid-stream, reports nothing", async () => {
    expect(await run(120)).toEqual([]);
  });

  test("a request that only starts once the wait resolves is still a waterfall", async () => {
    const events = await run(120, true);
    expect(events).toHaveLength(1);
    // The gate, then the call it gated. The frame's landing is the call's
    // own response streaming in — the same request, not a further link.
    expect((events[0].data as any).chain).toHaveLength(2);
  });
});
