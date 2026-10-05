/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The container-trace materializer loads LAZILY — codec face. The
// materializer is solid's projection machinery, the store engine's one edge
// into a server-component page, so the frames client no longer installs it
// at module load: the shared host's `prepareData` inspects each `data` chunk
// BEFORE it decodes and fetches `solid-js/internal/container-trace` only when
// the chunk's node tree carries the trace plugin's node (the plugin
// materializes AT decode, so the load has to come first; nothing after a
// decode revives). A page whose data never carries a trace never loads it.
//
// Its own spec file: the install is process-global state (the plugin's
// registered-symbol `state`), so the "not loaded" half can only be observed
// in a fresh worker; the document face has a file of its own for the same
// reason (frames-container-lazy-document.spec.tsx). The behaviour of a
// resident materializer is pinned in lifecycle-matrix/container-args.spec.tsx.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading, untrack } from "solid-js";
import { dynamic } from "../src/index.js";
import { getFrameHost, installServerComponents } from "../frames/src/client.js";
import { createServerReference } from "../server-functions/src/client.js";
import {
  isMaterializedContainer,
  needsContainerTraceMaterializer,
  setContainerTraceResolver,
  toBorderForm
} from "../frames/src/frame-container-plugin.js";
import { frameResponse, createDataSource, pump } from "./lifecycle-matrix/harness.js";

const getPlain = createServerReference("lazy/containers/plain");
const getTraced = createServerReference("lazy/containers/traced");
const traceState = () => (globalThis as any)[Symbol.for("solid.container-trace-state")];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const slotArticle =
  "<article><h1>T</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>";

// Harness-side server half: the sink envelopes any value the resolver claims.
const traces = new WeakMap<object, any>();
setContainerTraceResolver((v: unknown) =>
  typeof v === "object" && v !== null ? traces.get(v) : undefined
);
function traceProducer() {
  const queue: IteratorResult<any>[] = [];
  const waiters: ((r: IteratorResult<any>) => void)[] = [];
  const put = (r: IteratorResult<any>) => {
    const w = waiters.shift();
    w ? w(r) : queue.push(r);
  };
  const iterate = () => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          const b = queue.shift();
          return b
            ? Promise.resolve(b)
            : new Promise<IteratorResult<any>>(res => waiters.push(res));
        }
      };
    }
  });
  return {
    trace: { array: false, subscribe: iterate },
    push: (value: any) => put({ done: false, value }),
    end: () => put({ done: true, value: undefined })
  };
}

function mount(Comp: any, props: Record<string, any>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Comp {...props} />
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("codec face: the materializer loads behind the first data chunk that carries a trace", () => {
  test("a data chunk WITHOUT a trace decodes with nothing loaded", async () => {
    // The default shared host: the production wiring (prepareData scans).
    installServerComponents();
    expect(traceState()?.materializeTrace).toBeUndefined();
    const data = createDataSource();
    const initial = data.chunks("plain", 1, { user: { name: "Ada" } });
    expect(needsContainerTraceMaterializer(initial[0].node)).toBe(false);
    vi.stubGlobal("fetch", async () =>
      frameResponse("plain", [
        { type: "start", id: "plain", version: 1 },
        ...initial,
        {
          type: "slot",
          id: "plain",
          version: 1,
          key: "comment#0",
          args: { user: { $ref: "user" } }
        },
        { type: "html", id: "plain", version: 1, html: slotArticle },
        { type: "complete", id: "plain", version: 1 }
      ])
    );
    const Page = dynamic(() => getPlain() as any);
    const m = mount(Page, { comment: (p: any) => <li>{p.user.name}</li> });
    await pump(3);
    expect(m.div.querySelector("li")!.textContent).toBe("Ada");
    // The codec loaded (the data decoded); the materializer did not.
    expect(traceState()?.materializeTrace).toBeUndefined();
    m.cleanup();
  });

  test("a data chunk WITH a trace loads the materializer before it decodes: the {$ref} resolves to a live store", async () => {
    installServerComponents();
    expect(traceState()?.materializeTrace).toBeUndefined();
    const producer = traceProducer();
    const user = {};
    traces.set(user, producer.trace);
    const late: any[] = [];
    const data = createDataSource();
    const initial = data.chunks("traced", 1, { user: toBorderForm(user, true) }, c => late.push(c));
    // The scan sees the plugin's node in the chunk's tree, pre-decode.
    expect(needsContainerTraceMaterializer(initial[0].node)).toBe(true);
    vi.stubGlobal("fetch", async () =>
      frameResponse("traced", [
        { type: "start", id: "traced", version: 1 },
        ...initial,
        {
          type: "slot",
          id: "traced",
          version: 1,
          key: "comment#0",
          args: { user: { $ref: "user" } }
        },
        { type: "html", id: "traced", version: 1, html: slotArticle },
        { type: "complete", id: "traced", version: 1 }
      ])
    );
    let received: any;
    const Page = dynamic(() => getTraced() as any);
    const m = mount(Page, {
      comment: (p: any) => {
        received = untrack(() => p.user);
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <li>{p.user.name}</li>
          </Loading>
        );
      }
    });
    // The import settles on its own schedule: wait for the install, then
    // for the stream (queued behind it) to deliver and the fill to mount.
    for (let i = 0; i < 200 && !traceState()?.materializeTrace; i++) await sleep(10);
    expect(traceState()?.materializeTrace).toBeTypeOf("function");
    await pump(3);
    // Decoded AFTER the load: a live (pending) container, not an inert marker.
    expect(isMaterializedContainer(received)).toBe(true);
    expect(m.div.textContent).toContain("fill-wait");
    // Once installed, the scan is a no-op: nothing more to load.
    expect(needsContainerTraceMaterializer(initial[0].node)).toBe(false);

    // The snapshot lands through the (lazily loaded) codec's data table:
    // the fill's suspended read settles on the live store. The shared host
    // routes data by the call's ADDRESS (the transport rewrote the stream's
    // root id to it; an argless call's address is its function id).
    producer.push({ name: "Ada" });
    await sleep(0);
    for (const c of late.splice(0)) getFrameHost().apply({ ...c, id: "lazy/containers/traced" });
    await pump();
    expect(m.div.querySelector("li")!.textContent).toBe("Ada");
    m.cleanup();
    producer.end();
  });
});
