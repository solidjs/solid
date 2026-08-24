/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — ARG TIER: the CONTAINER tier (DR-2 case 3, Stage 5).
// A reactive container (a server projection) crosses the slot border as its
// TRACE — an async iterable whose first yield is a full state snapshot and
// whose later yields are PatchOp batches — and the client materializes it
// back into a live read-only store: reads suspend until the snapshot, then
// patch batches update it granularly, and the trace's end latches the last
// state. These cells pin the CLIENT PIPELINE halves on both faces:
//
//   - stream face: the trace rides the response's data table through the
//     codec's default plugin set (`{$ref}` args decode straight to a live
//     store);
//   - document face (t=0): the record carries a `{ $tr, $ta }` marker
//     literal that the host's `revive` hook materializes at arg-read.
//
// The producer halves (classification, envelope, wire shape) are pinned in
// dom-expressions `test/ssr/frame-container-trace.spec.js` and the real-core
// server faces in `test/server/container-traces.spec.tsx`; the materializer's
// unit semantics in solid `test/container-trace.spec.ts`. See MATRIX.md.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, flush, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "@solidjs/web/server-functions/client";
import {
  envelopeContainerTraces,
  reviveContainerTraces,
  setContainerTraceResolver
} from "@dom-expressions/runtime/src/frame-container-plugin.js";
import { makeHost, frameResponse, createDataSource, pump, settle } from "./harness.js";

const getStream = createServerReference("matrix/containers/stream");
const getShared = createServerReference("matrix/containers/shared");
const getAdopt = createServerReference("matrix/containers/adopt");

const slotArticle =
  "<article><h1>T</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>";

// The server half of the seam, harness-side: the sink envelopes any value the
// resolver claims. Registering fakes here mirrors what solid-web/server wires
// to getProjectionTrace — the matrix pins the border, not the reactive core.
const traces = new WeakMap<object, any>();
setContainerTraceResolver((v: unknown) =>
  typeof v === "object" && v !== null ? traces.get(v) : undefined
);

/** A hand-cranked trace producer: push the snapshot, then batches, then end. */
function traceProducer(opts: { array?: boolean } = {}) {
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
    trace: { array: !!opts.array, subscribe: iterate },
    push: (value: any) => put({ done: false, value }),
    end: () => put({ done: true, value: undefined })
  };
}

/** A container token standing in for the server's pending proxy. */
function makeContainer(producer: ReturnType<typeof traceProducer>) {
  const container = {};
  traces.set(container, producer.trace);
  return container;
}

function mountUnderLoading(Comp: any, props: Record<string, any> = {}) {
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
    dispose,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

// The adopted boundary's page setup runs FILE-level: the frames client's
// boundary index is module-scoped and seeded lazily at the first lookup —
// which the call-driven cells below trigger — so the SSR'd element must be
// on the page before ANY test mounts. The t=0 record carries the container
// as a `{ $tr, $ta }` marker literal at two depths — exactly what the
// document face serializes (markers, never `{$ref}`s: data scripts execute
// before any runtime is resident).
const adoptFid = "matrix/containers/adopt";
const adoptProducer = traceProducer();
beforeAll(() => {
  const marker = { $tr: adoptProducer.trace.subscribe(), $ta: 0 };
  document.body.innerHTML =
    '<div id="page">' +
    `<dx-frame data-fid="${adoptFid}" style="display:contents">` +
    "<article><h1>Adopt</h1><ul><!--slot:comment#c1:start-->" +
    '<li class="ssr-fill">server-rendered-fill</li>' +
    "<!--slot:comment#c1:end--></ul></article>" +
    "</dx-frame></div>";
  // done: the simulated page is fully parsed with no outstanding fragments —
  // otherwise boundaryMayArrive() holds every call-driven mount below
  // waiting for a document reveal that never comes.
  (window as any)._$HY = {
    done: true,
    r: {
      [`sc:slot:${adoptFid}:comment#c1`]: {
        cid: "c1",
        user: marker,
        // The SAME marker nested at depth: revival is deep and memoized.
        filters: { deep: { user: marker } }
      }
    }
  };
});

afterAll(() => {
  delete (window as any)._$HY;
  document.body.innerHTML = "";
});

afterEach(() => vi.unstubAllGlobals());

describe("call-driven/args/containers", () => {
  test("a CONTAINER {$ref} arg materializes live: suspend until snapshot, granular patch updates, latch at end", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const producer = traceProducer();
    const user = makeContainer(producer);
    const late: any[] = [];
    const data = createDataSource();
    const initial = data.chunks("srv", 1, { user: envelopeContainerTraces(user) }, c =>
      late.push(c)
    );
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...initial,
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { user: { $ref: "user" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const flushData = async () => {
      await settle();
      for (const c of late.splice(0)) host.apply(c);
      await pump();
    };

    let mounts = 0;
    const names: string[] = [];
    const roles: string[] = [];
    const Page = dynamic(() => getStream() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        // Successful reads record; a suspended read throws before the push.
        const name = createMemo(() => {
          const v = p.user.name;
          names.push(v);
          return v;
        });
        const role = createMemo(() => {
          const v = p.user.role;
          roles.push(v);
          return v;
        });
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <li>
              {name()}:{role()}
            </li>
          </Loading>
        );
      }
    });
    await pump();

    // The occurrence mounted; the store exists but is uninitialized — reads
    // suspend on the fill's own boundary, the same contract as a promise arg.
    expect(mounts).toBe(1);
    expect(m.div.textContent).toContain("fill-wait");
    expect(m.div.querySelector("li")).toBe(null);

    // Snapshot yield: the store settles to the full first state.
    producer.push({ name: "Ada", role: "admin" });
    await flushData();
    const li = m.div.querySelector("li")! as HTMLElement;
    expect(li.textContent).toBe("Ada:admin");
    expect(names).toEqual(["Ada"]);
    expect(roles).toEqual(["admin"]);

    // A patch batch updates GRANULARLY: the name read re-fires, the role
    // read does not (no snapshot diffing, no whole-store invalidation).
    producer.push([[["name"], "Grace"]]);
    await flushData();
    expect(m.div.querySelector("li")).toBe(li); // node identity survives
    expect(li.textContent).toBe("Grace:admin");
    expect(names).toEqual(["Ada", "Grace"]);
    expect(roles).toEqual(["admin"]);
    expect(mounts).toBe(1); // updates flow through the store, never a re-call

    // Trace end: the store latches at its last state — values hold, no
    // fallback re-flash, no teardown.
    producer.end();
    await flushData();
    expect(li.textContent).toBe("Grace:admin");
    expect(m.div.textContent).not.toContain("fill-wait");

    m.cleanup();
  });

  test("one container, two arg positions: both {$ref}s resolve to the SAME live store instance", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const producer = traceProducer();
    const user = makeContainer(producer);
    const late: any[] = [];
    const data = createDataSource();
    const initial = data.chunks("srv", 1, { u: envelopeContainerTraces(user) }, c => late.push(c));
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...initial,
        {
          type: "slot",
          id: "srv",
          version: 1,
          key: "comment#0",
          args: { author: { $ref: "u" }, editor: { $ref: "u" } }
        },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    let same: boolean | undefined;
    const Page = dynamic(() => getShared() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        // The container REFERENCE is available synchronously even while the
        // store is pending — only reads INTO it suspend. And materialization
        // is memoized per trace: however many references an argument graph
        // carries, there is ONE live container behind them.
        same = p.author === p.editor;
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <li>{p.author.name}</li>
          </Loading>
        );
      }
    });
    await pump();
    expect(same).toBe(true);

    producer.push({ name: "Ada" });
    await settle();
    for (const c of late.splice(0)) host.apply(c);
    await pump();
    expect(m.div.querySelector("li")!.textContent).toBe("Ada");

    producer.end();
    m.cleanup();
  });
});

describe("t=0/adopted-container-args", () => {
  test("an adopted record's container marker revives to a live store at arg-read (nested references share it)", async () => {
    const { host } = makeHost({ revive: reviveContainerTraces });
    installServerComponents(host);
    // Zero network: adoption answers the call from the document.
    vi.stubGlobal("fetch", async () => {
      throw new Error("t=0 adoption must not fetch");
    });
    const fid = adoptFid;
    const producer = adoptProducer;

    let same: boolean | undefined;
    const names: string[] = [];
    const Page = dynamic(() => getAdopt() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        same = p.user === p.filters.deep.user;
        const name = createMemo(() => {
          const v = p.user.name;
          names.push(v);
          return v;
        });
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <li class="live-fill">{name()}</li>
          </Loading>
        );
      }
    });
    await pump();

    // Adopted in place; the marker revived to ONE store for both references.
    expect(document.querySelector(`[data-fid="${fid}"]`)).not.toBe(null);
    expect(same).toBe(true);
    // Uninitialized until the document's data scripts feed the trace: the
    // fill's own boundary covers the read.
    expect(m.div.textContent).toContain("fill-wait");

    // The snapshot "script executes" (the producer yields): the store
    // settles and the adopted occurrence's fill renders live.
    producer.push({ name: "Ada" });
    await pump();
    expect(m.div.querySelector("li.live-fill")!.textContent).toBe("Ada");
    expect(names).toEqual(["Ada"]);

    // A later patch batch keeps updating the adopted occurrence.
    producer.push([[["name"], "Grace"]]);
    await pump();
    expect(m.div.querySelector("li.live-fill")!.textContent).toBe("Grace");
    expect(names).toEqual(["Ada", "Grace"]);

    producer.end();
    m.cleanup();
  });
});
