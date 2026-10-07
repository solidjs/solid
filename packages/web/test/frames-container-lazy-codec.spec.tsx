/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The traces tier — codec face. The container-trace materializer is solid's
// projection machinery, the store engine's one edge into a server-component
// page, so the frames client no longer installs it at module load: it is the
// `trace` TIER (`@solidjs/web/frames/trace`, frames savings pass §3 row C3),
// loaded through the tier mechanism. On the stream face the SERVER announces
// it: the sink mints `trace` where it serializes a trace, and the `data`
// chunk that carries the plugin's node leaves with `tiers: ["trace"]` in-band
// (test/server/tier-announce.spec pins the sink's half). The transport
// starts the load at that chunk and AWAITS it before the chunk decodes (the
// plugin materializes AT decode, so the install has to come first; nothing
// after a decode revives), as it awaits the codec itself. A response whose
// data never carries a trace announces nothing and loads nothing.
//
// S1's node scan (`prepareData` inspecting each chunk's tree) is not kept:
// the announcement rides the very chunk the scan would have found the node
// in, from the same site that serialized it, so the scan is unreachable
// behind it (the plan's §3 row C3 / §5 — measured +79 B min / +25 B br on
// the eager client to keep; dropped). An un-announced chunk from a producer
// that predates the tier decodes the inert marker (the plugin's hookless
// fallback) — a skew the frames server and client, one package, never ship.
//
// A tier, once resident, stays so for the worker: the gated loader is
// installed per test (`installServerComponents({ tiers })` replaces the
// built-in entry) and the load dropped between tests (`tierLoads`, the
// runtime's test seam). The behaviour of a resident tier is pinned in
// lifecycle-matrix/container-args.spec.tsx; the document face in
// frames-container-lazy-document.spec.tsx.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading, untrack } from "solid-js";
import { dynamic } from "../src/index.js";
import { getFrameHost, installServerComponents } from "../frames/src/client.js";
import { tierLoads } from "../frames/src/frame-client.js";
import { createServerReference } from "../server-functions/src/client.js";
import {
  isMaterializedContainer,
  setContainerTraceResolver,
  toBorderForm
} from "../frames/src/frame-container-plugin.js";
import { frameResponse, createDataSource, pump } from "./lifecycle-matrix/harness.js";

const getPlain = createServerReference("lazy/containers/plain");
const getTraced = createServerReference("lazy/containers/traced");
const traceTierResident = () => !!(tierLoads as any).trace?.r;

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

/** The tier's load, gated by the test; `release()` installs the real module. */
function gateTraceTier() {
  delete (tierLoads as any).trace;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  installServerComponents(undefined, { tiers: { trace: loader } });
  return { loader, release: async () => resolve(await import("../frames/src/trace-tier.js")) };
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

describe("codec face: the traces tier loads behind the data chunk that announces it", () => {
  test("a data chunk WITHOUT a trace announces nothing and decodes with nothing loaded", async () => {
    const gated = gateTraceTier();
    const data = createDataSource();
    const initial = data.chunks("plain", 1, { user: { name: "Ada" } });
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
    // The codec loaded (the data decoded); the tier was never asked for.
    expect(gated.loader).not.toHaveBeenCalled();
    expect((tierLoads as any).trace).toBeUndefined();
    m.cleanup();
  });

  test("a data chunk WITH a trace announces the tier and awaits it before it decodes: the {$ref} resolves to a live store", async () => {
    const gated = gateTraceTier();
    const producer = traceProducer();
    const user = {};
    traces.set(user, producer.trace);
    const late: any[] = [];
    const data = createDataSource();
    const initial = data.chunks("traced", 1, { user: toBorderForm(user, true) }, c => late.push(c));
    // What the sink emits for this chunk: the trace's announcement rides it.
    initial[0].tiers = ["trace"];
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
    let mounts = 0;
    const Page = dynamic(() => getTraced() as any);
    const m = mount(Page, {
      comment: (p: any) => {
        mounts++;
        received = untrack(() => p.user);
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <li>{p.user.name}</li>
          </Loading>
        );
      }
    });
    await pump(3);
    // The announcement started the load at the chunk — and the chunk is
    // held behind it: nothing decoded, the record and the shell behind it
    // in the sequential drain wait too (chunk ORDER is the contract).
    expect(gated.loader).toHaveBeenCalledTimes(1);
    expect(traceTierResident()).toBe(false);
    expect(m.div.querySelector("article")).toBeNull();
    expect(mounts).toBe(0);

    // The load settles: the install, then the drain resumes — the data
    // decodes with the materializer resident.
    await gated.release();
    await pump(3);
    expect(traceTierResident()).toBe(true);
    expect(mounts).toBe(1);
    // Decoded AFTER the load: a live (pending) container, not an inert marker.
    expect(isMaterializedContainer(received)).toBe(true);
    expect(m.div.textContent).toContain("fill-wait");

    // The snapshot lands through the (lazily loaded) codec's data table:
    // the fill's suspended read settles on the live store. The shared host
    // routes data by the call's ADDRESS (the transport rewrote the stream's
    // root id to it; an argless call's address is its function id).
    producer.push({ name: "Ada" });
    await pump();
    for (const c of late.splice(0)) getFrameHost().apply({ ...c, id: "lazy/containers/traced" });
    await pump();
    expect(m.div.querySelector("li")!.textContent).toBe("Ada");
    m.cleanup();
    producer.end();
  });
});
