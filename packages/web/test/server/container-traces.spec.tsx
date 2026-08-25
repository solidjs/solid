/**
 * @jsxImportSource @solidjs/web
 */
// The container tier at the slot border (DR-2 case 3), real core: solid
// projections passed as slot args serialize as TRACES — snapshot then patch
// batches, the continuation protocol hydration resume uses — and plain
// stores serialize as the plain data they are (constants within a
// response). Covers both faces:
//
//  - stream face (renderServerComponent): the arg ships as a data ref whose
//    records carry the trace through the JSON codec;
//  - document face (frameTransformDirectResult under renderToStream): the
//    record ships the trace as an eval marker, while the inline fill reads
//    the projection directly — pending reads suspend into the covering
//    boundary like any server async read.
//
// The trace resolver is installed by the entries themselves (server/index.ts
// and frames/src/server.ts): importing @solidjs/web here is what arms it,
// which is exactly the no-wiring contract apps get.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createStore, createProjection, createMemo } from "solid-js";
import {
  renderServerComponent,
  frameTransformDirectResult,
  ServerComponentPlugin
} from "../../src/frame-sink.js";

const TRACE_TAG = "dom-expressions/container-trace";
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectStream(component: any) {
  return new Promise<any[]>((resolve, reject) => {
    const chunks: any[] = [];
    renderServerComponent(component, { frame: { id: "f" } }).pipe({
      write: (c: any) => chunks.push(c),
      end: () => resolve(chunks)
    });
    setTimeout(() => reject(new Error("stream never ended")), 2000);
  });
}

function collectDocument(code: () => any) {
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
    setTimeout(() => reject(new Error("document never ended")), 2000);
  });
}

const dataWire = (chunks: any[], key: string) =>
  JSON.stringify(chunks.filter(c => c.type === "data" && c.key === key).map(c => c.node));

describe("container tier — stream face", () => {
  test("a settled plain store is a constant: plain data, no trace", async () => {
    const ServerComp = (props: any) => {
      const [state] = createStore({ user: { name: "Ada" }, count: 1 });
      return <div>{props.row({ data: state })}</div>;
    };
    const chunks = await collectStream(ServerComp);
    const slot = chunks.find(c => c.type === "slot");
    expect(slot.args.data.$ref).toBe("arg:row#0:data");
    const wire = dataWire(chunks, "arg:row#0:data");
    expect(wire).toContain("Ada");
    expect(wire).not.toContain(TRACE_TAG);
  });

  test("a pending projection ships promptly as a trace and settles the stream", async () => {
    const ServerComp = (props: any) => {
      const user = createMemo(() => wait(10).then(() => ({ name: "Ada" })));
      const proj = createProjection((draft: any) => {
        draft.name = (user() as any).name;
      }, {} as any);
      return <div>{props.row({ data: proj })}</div>;
    };
    const chunks = await collectStream(ServerComp);
    // No stream error — the pre-Stage-5 failure mode was a seroval crash on
    // the pending proxy's property walk.
    expect(chunks.find(c => c.type === "error")).toBeUndefined();
    const slot = chunks.find(c => c.type === "slot");
    expect(slot.args.data.$ref).toBe("arg:row#0:data");
    // The record shipped BEFORE the projection settled (index order), and
    // the trace's snapshot carries the settled state.
    const wire = dataWire(chunks, "arg:row#0:data");
    expect(wire).toContain(TRACE_TAG);
    expect(wire).toContain("Ada");
    expect(chunks.findIndex(c => c.type === "complete")).toBeGreaterThan(chunks.indexOf(slot));
  });

  test("a generator projection's trace carries snapshot then patch batches", async () => {
    const ServerComp = (props: any) => {
      const proj = createProjection(async function* (draft: any) {
        draft.step = 1;
        yield;
        await wait(10);
        draft.step = 2;
        yield;
      }, {} as any);
      return <div>{props.row({ data: proj })}</div>;
    };
    const chunks = await collectStream(ServerComp);
    expect(chunks.find(c => c.type === "error")).toBeUndefined();
    const records = chunks.filter(c => c.type === "data" && c.key === "arg:row#0:data");
    const wire = JSON.stringify(records.map(c => c.node));
    expect(wire).toContain(TRACE_TAG);
    // Snapshot at V1 (step: 1) and a later batch writing step -> 2.
    const stepValues = [...wire.matchAll(/"step"/g)];
    expect(stepValues.length).toBeGreaterThanOrEqual(2);
    expect(wire).toContain("2");
  });

  test("a projection minted INLINE in the arg expression latches instead of re-emitting", async () => {
    // `data={createProjection(...)}` in JSX compiles to a getter the ledger
    // would re-run per commit — each run minting a FRESH projection with a
    // fresh trace whose pump never ends: record churn and a hung stream.
    // The scope-creation stamp gates it: the arg ships its first value and
    // latches (the projection's own trace is the liveness).
    const ServerComp = (props: any) => {
      // A second arg that settles later, so a commit really sweeps the ledger.
      const tick = createMemo(() => wait(10).then(() => "done"));
      return (
        <div>
          <props.row
            status={tick()}
            data={createProjection(async function* (draft: any) {
              draft.n = 1;
              yield;
              await wait(5);
              draft.n = 2;
              yield;
            }, {} as any)}
          />
        </div>
      );
    };
    const chunks = await collectStream(ServerComp);
    expect(chunks.find(c => c.type === "error")).toBeUndefined();
    // One ref for the arg (repeated data chunks under it are the trace's own
    // streaming continuations) — a ledger re-emission would mint versioned
    // `@n` refs, one fresh trace per commit.
    const dataKeys = chunks
      .filter(c => c.type === "data" && String(c.key).startsWith("arg:row#0:data"))
      .map(c => c.key);
    expect(dataKeys.length).toBeGreaterThan(0);
    expect(dataKeys.filter(k => String(k).includes("@"))).toEqual([]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  });

  test("a projection nested inside a plain object arg envelopes at depth", async () => {
    const ServerComp = (props: any) => {
      const user = createMemo(() => wait(10).then(() => ({ name: "Ada" })));
      const proj = createProjection((draft: any) => {
        draft.name = (user() as any).name;
      }, {} as any);
      return <div>{props.row({ filters: { by: proj, page: 1 } })}</div>;
    };
    const chunks = await collectStream(ServerComp);
    expect(chunks.find(c => c.type === "error")).toBeUndefined();
    const wire = dataWire(chunks, "arg:row#0:filters");
    expect(wire).toContain(TRACE_TAG);
    expect(wire).toContain("Ada");
  });
});

describe("container tier — document face", () => {
  test("a settled plain store passes as plain data; the fill reads it inline", async () => {
    const ServerComp = (props: any) => {
      const [state] = createStore({ user: { name: "Ada" } });
      return (
        <section>
          <props.status data={state} />
        </section>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "doc-store" }) as any;
    const html = await collectDocument(() => (
      <Inline status={(p: any) => <span>{p.data.user.name}</span>} />
    ));
    expect(html).toContain("Ada");
    expect(html).toContain("sc:slot:doc-store");
    expect(html).not.toContain("$tr:");
  });

  test("a pending projection suspends the fill into the boundary and ships as a trace", async () => {
    const ServerComp = (props: any) => {
      const user = createMemo(() => wait(10).then(() => ({ name: "Ada" })));
      const proj = createProjection((draft: any) => {
        draft.name = (user() as any).name;
      }, {} as any);
      return (
        <Loading fallback={<p>loading</p>}>
          <section>
            <props.status data={proj} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "doc-proj" }) as any;
    const html = await collectDocument(() => (
      <Inline status={(p: any) => <span>{p.data.name}</span>} />
    ));
    // The fill's read settled server-side (boundary held, retried) and the
    // record carries the trace marker for the adopting client.
    expect(html).toContain("Ada");
    expect(html).toContain("$tr:");
  });

  test("a projection minted INLINE in the arg expression latches (document face)", async () => {
    // Same gate as the stream face: without it the document's arg ledger
    // re-mints a projection per sweep and every fresh trace holds the
    // hydration serializer open — the response never ends.
    const ServerComp = (props: any) => {
      const tick = createMemo(() => wait(10).then(() => "done"));
      return (
        <Loading fallback={<p>loading</p>}>
          <section>
            <props.status
              note={tick()}
              data={createProjection(async function* (draft: any) {
                draft.n = 1;
                yield;
                await wait(5);
                draft.n = 2;
                yield;
              }, {} as any)}
            />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "doc-mint" }) as any;
    // collectDocument's timeout is the assertion that matters: the response ends.
    const html = await collectDocument(() => (
      <Inline status={(p: any) => <span>{p.data.n}</span>} />
    ));
    expect(html).toContain("$tr:");
  });

  test("a generator projection's markup shows V1; the record carries the live trace", async () => {
    const ServerComp = (props: any) => {
      const proj = createProjection(async function* (draft: any) {
        draft.label = "v1";
        yield;
        await wait(10);
        draft.label = "v2";
        yield;
      }, {} as any);
      return (
        <Loading fallback={<p>loading</p>}>
          <section>
            <props.status data={proj} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "doc-gen" }) as any;
    const html = await collectDocument(() => (
      <Inline status={(p: any) => <span>{p.data.label}</span>} />
    ));
    // Markup locked at V1 (the SSR-visible frozen state)…
    expect(html).toMatch(/<span[^>]*>v1<\/span>/);
    // …while the trace in the record streams through v2 for the client.
    expect(html).toContain("$tr:");
    expect(html).toContain("v2");
  });
});
