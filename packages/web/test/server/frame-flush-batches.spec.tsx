/**
 * @jsxImportSource @solidjs/web
 *
 * The wire's unit is the flush: the records the producer writes in one
 * synchronous run leave as ONE `{ id, version, r }` message per frame
 * (frame-sink.ts, `put`), at the run's end — a microtask, never a timer —
 * and in the order they were written. A batch is merged into only while
 * writes address its frame back to back with keys it does not hold yet:
 * another frame's records, a repeated key or a `data` node start the next
 * one, so every write still lands, in order.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { Loading, useHead } from "@solidjs/web";
import { createFrameSink, renderServerComponent } from "../../frames/src/frame-sink.js";
import { writes } from "./wire.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const collect = (stream: any): Promise<any[]> => stream;

function sink() {
  const out: any[] = [];
  return { out, sink: createFrameSink(m => out.push(m), { id: "f", version: 1 }) as any };
}

describe("the sink's batch", () => {
  it("one synchronous run is one message, written at the run's end", async () => {
    const { out, sink: s } = sink();
    s.slot("a#0", { n: 1 });
    s.slot("b#0", { n: 2 });
    s.reveal(["01", "02"]);
    expect(out).toEqual([]);
    await Promise.resolve();
    expect(out.map(writes)).toEqual(["slot:a#0 slot:b#0 seg:01:reveal seg:02:reveal"]);
    expect(out[0]).toMatchObject({ id: "f", version: 1 });
  });

  it("a repeated key, another frame's records or a data node start the next batch", async () => {
    const { out, sink: s } = sink();
    s.slot("a#0", { n: 1 });
    s.slot("a#0", { n: 2 });
    s.region("f.a#0.body", "<i>body</i>");
    s.slot("b#0", { n: 3 });
    s.data({ key: "k", node: { t: 0, s: 1 } });
    s.slot("c#0", { n: 4 });
    await Promise.resolve();
    expect(out.map(m => [m.id, writes(m)])).toEqual([
      ["f", "slot:a#0"],
      ["f", "slot:a#0"],
      ["f.a#0.body", ""],
      ["f", "slot:b#0"],
      ["f", "data"],
      ["f", "slot:c#0"]
    ]);
    // Both writes of the repeated key land, in order.
    expect(out[0].r["slot:a#0"].args).toEqual({ n: 1 });
    expect(out[1].r["slot:a#0"].args).toEqual({ n: 2 });
  });

  it("the end flushes: nothing written before it is left queued", () => {
    const { out, sink: s } = sink();
    s.slot("a#0", {});
    s.end();
    expect(out.map(writes)).toEqual(["slot:a#0 :complete"]);
  });

  it("a late root assets record rides a batch of its own", async () => {
    const { out, sink: s } = sink();
    s.reveal(["01"]);
    s.asset("module", "/late.js");
    s.reveal(["02"]);
    await Promise.resolve();
    expect(out.map(writes)).toEqual(["seg:01:reveal", "seg::assets", "seg:02:reveal"]);
  });
});

describe("a rendered response", () => {
  it("a segment's assets, content and reveal leave as one message; frames and data nodes split, in write order", async () => {
    const Late = (props: any) => {
      const data = createMemo(() => wait(10).then(() => "late"));
      return (
        <section>
          <Loading fallback={<p>waiting</p>}>
            {(() => {
              const v = data() as any;
              useHead({ tag: "link", props: { rel: "stylesheet", href: "/late.css" } });
              return <b>{props.panel({ body: <i>{v}</i>, meta: { v } })}</b>;
            })()}
          </Loading>
        </section>
      );
    };
    const chunks = await collect(renderServerComponent(Late, { frame: { id: "fb" } }));
    const at = chunks.findIndex(c => c.id === "fb.panel#0.body");
    const k = Object.keys(chunks[chunks.length - 2].r)[1].slice(4);
    // The segment settles in one run: its region's root (another frame),
    // the slot record that places it, the arg's data node, then the
    // segment's own records together.
    expect(chunks.slice(at).map(c => [c.id, writes(c)])).toEqual([
      ["fb.panel#0.body", ""],
      ["fb", "slot:panel#0"],
      ["fb", "data"],
      ["fb", `seg:${k}:assets seg:${k} seg:${k}:reveal`],
      ["fb", ":complete"]
    ]);
  });
});
