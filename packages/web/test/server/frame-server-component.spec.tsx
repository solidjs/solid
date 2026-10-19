/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, it } from "vitest";
import { children, createMemo, merge } from "solid-js";
import { Loading } from "@solidjs/web";

const asyncValue = <T,>(value: T, ms = 10): Promise<T> =>
  new Promise(r => setTimeout(() => r(value), ms));
// Direct source imports of the frame sink: this exercises the slot proxy
// under Solid's real SSR compile + reactive core.
import { renderServerComponent } from "../../frames/src/frame-sink.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import { has, record, records } from "./wire.js";

const collect = (stream: any): Promise<any[]> => stream;
/** The root's html. */
const root = (chunks: any[]) => record(chunks, "").value;
/** Slot records in wire order as `{ key, args }` (one occurrence's, given its id). */
const slots = (chunks: any[], occurrence?: string) =>
  records(chunks, "slot:")
    .filter(([key]) => !occurrence || key === `slot:${occurrence}`)
    .map(([key, r]) => ({ key: key.slice(5), args: r.args }));

describe("server components authored with Solid JSX", () => {
  it("emits a direct-insert marker for {props.children} through the SSR compile", async () => {
    const ServerComp = (props: any) => (
      <section>
        <h1>Story</h1>
        {props.children}
      </section>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f0" } }));
    const html = root(chunks);
    expect(html).toContain("<h1>Story</h1>");
    expect(html).toContain("<!--slot:children:start--><!--slot:children:end-->");
    expect(slots(chunks)).toEqual([]);
  });

  it("treats a prop used in component position as a render-prop slot", async () => {
    // The natural Solid authoring for a client slot with args: SSR
    // compiles component-position props to direct calls, which is exactly
    // the proxy's render-prop shape.
    const ServerComp = (props: any) => (
      <ul>
        {["a", "b"].map((label, i) => (
          <props.comment label={label} meta={{ i }} />
        ))}
      </ul>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f1" } }));
    const found = slots(chunks);
    expect(found.map(c => c.key)).toEqual(["comment#0", "comment#1"]);
    expect(found[0].args.label).toBe("a");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    expect(table.resolve(found[1].args.meta)).toEqual({ i: 1 });
    const html = root(chunks);
    expect(html).toContain("<!--slot:comment#0:start--><!--slot:comment#0:end-->");
    expect(html).toContain("<!--slot:comment#1:start--><!--slot:comment#1:end-->");
  });

  it("resolves slot ranges through merge() — props win, defaults never mask positions", async () => {
    const ServerComp = (_props: any) => {
      const props = merge({ header: () => "default" }, _props);
      return (
        <section>
          {props.header}
          <props.row label="a" />
        </section>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f3" } }));
    const html = root(chunks);
    // The slot proxy's `has: true` routes merge down its proxy path
    // and wins per-property resolution: both the child read and the
    // component-position call reach the slot proxy, not the default.
    expect(html).toContain("<!--slot:header:start--><!--slot:header:end-->");
    expect(html).toContain("<!--slot:row#0:start--><!--slot:row#0:end-->");
    expect(html).not.toContain("default");
    expect(slots(chunks).map(c => c.key)).toEqual(["row#0"]);
  });

  it("does not become thenable under merge/await plumbing", async () => {
    const ServerComp = (props: any) => {
      // A stray Promise.resolve(props) must not invoke a phantom `then` slot.
      void Promise.resolve(props);
      return <div>ok</div>;
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f4" } }));
    expect(slots(chunks)).toEqual([]);
    expect(root(chunks)).toMatch(/^<div( _hk=\d+)?>ok<\/div>$/);
  });

  it("streams a real <Loading> boundary as segment + reveal records, slot ranges inside", async () => {
    const ServerComp = (props: any) => {
      const data = createMemo(async () => asyncValue("Comments loaded", 10));
      return (
        <article>
          <h1>Story</h1>
          <Loading fallback={<span>loading…</span>}>
            <section>
              {data()}
              {props.children}
            </section>
          </Loading>
        </article>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "s" } }));
    const html = root(chunks);
    // Shell flushes with the boundary's placeholder range, fallback in the
    // template — Solid's Loading drives registerFragment through the sink.
    expect(html).toContain("<h1>Story</h1>");
    expect(html).toMatch(/<template id="pl-[^"]+">.*loading…/);
    expect(html).not.toContain("Comments loaded");
    const [[fragKey, frag]] = records(chunks, "seg:").filter(([key]) => /^seg:[^:]+$/.test(key));
    expect(frag.value).toContain("Comments loaded");
    // The thread-through case: a slot declared inside streamed async
    // content — the client slot mounts when the fragment reveals.
    expect(frag.value).toContain("<!--slot:children:start--><!--slot:children:end-->");
    const reveals = records(chunks, "seg:").filter(([key]) => key.endsWith(":reveal"));
    expect(reveals).toEqual([[`${fragKey}:reveal`, true]]);
    expect(has(chunks[chunks.length - 1], ":complete")).toBe(true);
  });

  it("survives the children() helper", async () => {
    const ServerComp = (props: any) => {
      const resolved = children(() => props.children);
      return <div>{resolved()}</div>;
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f2" } }));
    const html = root(chunks);
    // The hydratable compile allocates a hydration key around the children()
    // memo — expected; the slot range itself is intact.
    expect(html).toMatch(
      /^<div( _hk=\d+)?><!--slot:children:start--><!--slot:children:end--><\/div>$/
    );
  });
});

describe("watched slot args through Solid's reactive core (DR-2 case 1)", () => {
  // The authored form of the Q1 gap: `<props.slot thing={thing()} />`
  // compiles the arg to a GETTER, and the producer opens a watched binding
  // for it — re-evaluated at every commit the response observes, re-emitting
  // the occurrence's record when the value changed. These tests wire the
  // full stack: Solid's server memos advance their values (the ctx.commit
  // hooks and the iterator pump), the sink's ledger sweeps, and the record
  // re-emits — within the response window only.

  it("a getter over an async-iterable memo stays live: later yields re-emit the record", async () => {
    async function* ticks() {
      yield "1";
      await asyncValue(null, 5);
      yield "2";
      await asyncValue(null, 5);
      yield "3";
    }
    const ServerComp = (props: any) => {
      const progress = createMemo(() => ticks());
      // Something else must hold the response window open past the yields:
      // the pump never holds completion (the window latches when the
      // response's own work is done). This boundary settles after the
      // iterator finishes — the chat-example shape.
      const hold = createMemo(async () => asyncValue("done", 40));
      return (
        <div>
          <props.status progress={progress()} />
          <Loading fallback={<span>…</span>}>
            <p>{hold()}</p>
          </Loading>
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "live" } }));
    const status = slots(chunks, "status#0");
    // The record shipped immediately — the memo wasn't ready at emission, so
    // the first record's arg is the pending ref the retry loop settles with
    // the FIRST yield.
    expect(status[0].args.progress.$ref).toBe("arg:status#0:progress");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    await expect(table.resolve(status[0].args.progress)).resolves.toBe("1");
    // Each later yield advanced the memo and committed: the sweep re-read
    // the getter and re-emitted the record with the new scalar inline. The
    // last record latches the final yield before complete.
    const inline = status.map(s => s.args.progress).filter(v => typeof v === "string");
    expect(inline[inline.length - 1]).toBe("3");
    expect(has(chunks[chunks.length - 1], ":complete")).toBe(true);
  });

  it("a promise memo's settle commits: a getter reading state it mutated re-emits", async () => {
    const ServerComp = (props: any) => {
      const state = { stage: "first" };
      const done = createMemo(async () => {
        await asyncValue(null, 10);
        state.stage = "second";
        return "ok";
      });
      return (
        <div>
          <props.row stage={state.stage} />
          <Loading fallback={<span>…</span>}>
            <p>{done()}</p>
          </Loading>
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "settle" } }));
    const rows = slots(chunks, "row#0");
    // Emission read "first"; the memo's settle poked the commit hook (and
    // its fragment flushed through the sink) — either way the sweep saw
    // "second" and re-emitted before completion latched it.
    expect(rows[0].args.stage).toBe("first");
    expect(rows[rows.length - 1].args.stage).toBe("second");
    expect(has(chunks[chunks.length - 1], ":complete")).toBe(true);
  });

  it("a getter through a sync-derivation memo recomputes per commit (epoch caching)", async () => {
    // The cliff the design forbids: `v={derived()}` must behave like the
    // inlined expression. Server memos cache — per RENDER in document SSR,
    // per commit EPOCH in frame renders — so the sweep's re-read pulls a
    // fresh derivation instead of the first render's cache.
    const ServerComp = (props: any) => {
      const state = { n: 1 };
      const derived = createMemo(() => state.n * 10);
      const done = createMemo(async () => {
        await asyncValue(null, 10);
        state.n = 2;
        return "ok";
      });
      return (
        <div>
          <props.row v={derived()} />
          <Loading fallback={<span>…</span>}>
            <p>{done()}</p>
          </Loading>
        </div>
      );
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "epoch" } }));
    const rows = slots(chunks, "row#0");
    expect(rows[0].args.v).toBe(10);
    expect(rows[rows.length - 1].args.v).toBe(20);
    expect(has(chunks[chunks.length - 1], ":complete")).toBe(true);
  });
});
