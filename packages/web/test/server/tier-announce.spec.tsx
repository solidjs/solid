/**
 * @jsxImportSource @solidjs/web
 */
// The server-announced tier mechanism, server half (frames savings pass
// §2, Phase B): both faces announce the frames-client tiers the render
// MINTED — the stream face on the response head (`X-Frame-Tiers`, the tiers
// the sync render pass produced) and in-band (`chunk.tiers` on the next
// chunk out, for a tier first needed after the head left); the document
// face as the `_$HY.r["sc:tiers"]` hydration record (re-written cumulative
// at each new mint) plus a `modulepreload` per tier whose chunk URL the
// integration gave (`frameTransformDirectResult`'s `tierUrls`). Nothing is
// announced when nothing is minted: a response or page with no tiered
// feature carries no header, no `tiers` member, no record, no link.
//
// The mint sites: a binding-slot position read (`bind`), a nested
// server-content region (`regions`), an assets chunk (`assets`), a traced
// container in a slot arg (`trace`), a `live` response (`wire`).
import { describe, expect, it } from "vitest";
import { Loading, renderToStream, renderToString, useHead } from "@solidjs/web";
import { createMemo, createProjection } from "solid-js";
import {
  frameTransformDirectResult,
  renderServerComponent,
  serverComponentResponse,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";
import { FRAME_TIERS_HEADER } from "../../frames/src/frame-transport.js";
import { ChunkReader } from "../../server-functions/src/shared.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const collect = (stream: any): Promise<any[]> => stream;

/** Every chunk of a frame-stream Response's body, decoded. */
async function bodyChunks(response: Response): Promise<any[]> {
  const reader = new ChunkReader(response.body!);
  const out: any[] = [];
  for (let r = await reader.next(); !r.done; r = await reader.next())
    out.push(JSON.parse(r.value as string));
  return out;
}

function document(code: () => any, options: Record<string, unknown> = {}): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin], ...options } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

/** The value of the LAST `sc:tiers` assignment in a document, or undefined. */
function tiersRecord(html: string): string[] | undefined {
  // Seroval may assign the value a cross-reference slot (`$R[n]=`) first.
  const all = [...html.matchAll(/_\$HY\.r\["sc:tiers"\]=(?:\$R\[\d+\]=)?(\[[^\]]*\])/g)];
  return all.length ? JSON.parse(all[all.length - 1][1].replace(/`/g, '"')) : undefined;
}

// A server component with nothing tiered: markup and a direct-insert slot.
const Plain = (props: any) => (
  <section>
    <h1>Story</h1>
    {props.children}
  </section>
);
// A binding slot: one property read off the call's return is a position.
const Bound = (props: any) => {
  const row = props.row({ id: 1 });
  return <li class={row.cls}>item</li>;
};
// A region: server JSX passed as a slot arg.
const Regioned = (props: any) => <div>{props.panel({ body: <p>server body</p> })}</div>;
// A trace: a live projection (one over an async source — a settled sync
// projection is a constant and ships as plain data) passed as a slot arg.
const Traced = (props: any) => {
  const user = createMemo(() => wait(5).then(() => ({ n: 1 })));
  const proj = createProjection((draft: any) => {
    draft.n = (user() as any).n;
  }, {} as any);
  return <div>{props.row({ data: proj })}</div>;
};

describe("tier announcement — stream face", () => {
  it("announces nothing when nothing is minted: no header, no `tiers` on any chunk", async () => {
    const response = serverComponentResponse(Plain, { frame: { id: "ta-none" } });
    expect(response.headers.has(FRAME_TIERS_HEADER)).toBe(false);
    const chunks = await bodyChunks(response);
    expect(chunks.some(c => "tiers" in c)).toBe(false);
    expect(chunks.find(c => c.type === "html").html).toContain("<h1>Story</h1>");
  });

  it("`bind`: a binding-slot position read in the sync pass is on the response head", async () => {
    const response = serverComponentResponse(Bound, { frame: { id: "ta-bind" } });
    expect(response.headers.get(FRAME_TIERS_HEADER)).toBe("bind");
    const chunks = await bodyChunks(response);
    // The head carried it; nothing is owed in-band.
    expect(chunks.some(c => "tiers" in c)).toBe(false);
    expect(chunks.find(c => c.type === "html").html).toContain('_s:class="row#0:cls"');
  });

  it("`regions`: a nested region is announced, once, and rides the head", async () => {
    const response = serverComponentResponse(Regioned, { frame: { id: "ta-reg" } });
    expect(response.headers.get(FRAME_TIERS_HEADER)).toBe("regions");
    const chunks = await bodyChunks(response);
    expect(chunks.find(c => c.type === "slot").args.body).toEqual({
      $frame: "ta-reg.panel#0.body"
    });
  });

  it("`trace`: a traced container in a slot arg announces on its own data chunk", async () => {
    const response = serverComponentResponse(Traced, { frame: { id: "ta-tr" } });
    const chunks = await bodyChunks(response);
    // The announcement rides the record's data chunk itself: the mint
    // (`argBorderForm` meeting the container) precedes the serializer's
    // synchronous emission of the initial node, so the chunk whose node
    // tree needs the tier is the chunk that names it — the client awaits
    // the tier before decoding exactly that chunk. (A live projection is
    // pending at first render; the hole that calls the slot re-pulls after
    // the sync pass, so the head did not know — the in-band form is what
    // carries this one.)
    const data = chunks.filter(c => c.type === "data" && c.key === "arg:row#0:data");
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].tiers).toEqual(["trace"]);
    expect(data[0].initial).toBe(true);
    // Once: the later patch nodes and every other chunk carry nothing.
    expect(chunks.filter(c => c.tiers).length).toBe(1);
    // Head and body agree: a tier is announced by one or the other.
    const head = response.headers.get(FRAME_TIERS_HEADER);
    expect(head === null || head === "trace").toBe(true);
  });

  it("`wire`: a `live` response announces the wire tier", async () => {
    const response = serverComponentResponse(Plain, { frame: { id: "ta-wire" }, live: true });
    expect(response.headers.get(FRAME_TIERS_HEADER)).toBe("wire");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    // Not read: a live body stays open for its heartbeat; cancel it.
    await response.body!.cancel();
  });

  it("several tiers: comma-separated, in mint order", async () => {
    const Both = (props: any) => {
      const row = props.row({ id: 1 });
      return (
        <ul>
          <li class={row.cls}>{props.panel({ body: <p>x</p> })}</li>
        </ul>
      );
    };
    const response = serverComponentResponse(Both, { frame: { id: "ta-both" } });
    expect(response.headers.get(FRAME_TIERS_HEADER)!.split(",").sort()).toEqual([
      "bind",
      "regions"
    ]);
    await bodyChunks(response);
  });

  it("a tier first minted after the head left rides in-band on the next chunk (`assets`, `bind` inside a late segment)", async () => {
    // The style-gated fragment: a stylesheet registered inside a boundary
    // that resolves after the shell flush. Its assets chunk is the first
    // the sink emits after the mint, so the chunk carries the name. The
    // binding-slot read inside the same late content is minted after the
    // head too; both ride the next chunk out.
    const Late = (props: any) => {
      const data = createMemo(() => wait(10).then(() => "late"));
      return (
        <Loading fallback={<p>waiting</p>}>
          {(() => {
            const v = data() as any;
            useHead({ tag: "link", props: { rel: "stylesheet", href: "/late.css" } });
            const row = props.row({ id: v });
            return <b class={row.cls}>{v}</b>;
          })()}
        </Loading>
      );
    };
    const response = serverComponentResponse(Late, { frame: { id: "ta-late" } });
    // The head knew nothing yet: no header.
    expect(response.headers.has(FRAME_TIERS_HEADER)).toBe(false);
    const chunks = await bodyChunks(response);
    const announced = chunks.filter(c => c.tiers);
    expect(announced.length).toBeGreaterThan(0);
    const names = announced.flatMap(c => c.tiers).sort();
    expect(names).toEqual(["assets", "bind"]);
    // The announcement precedes (or is) the chunk that needs it: the
    // `assets` chunk carries `assets`; the fragment with the `_s:` marker
    // does not precede the chunk naming `bind`.
    const assets = chunks.find(c => c.type === "assets");
    expect(assets.tiers).toContain("assets");
    const bindAt = chunks.findIndex(c => c.tiers && c.tiers.includes("bind"));
    const fragmentAt = chunks.findIndex(c => c.type === "fragment");
    expect(bindAt).toBeLessThanOrEqual(fragmentAt);
    expect(chunks[fragmentAt].html).toContain("_s:class=");
    // Reveal is style-gated, as before.
    expect(chunks.find(c => c.type === "reveal").waitForStyles).toBe(true);
  });

  it("a stream consumed without a Response (renderServerComponent) announces in-band only", async () => {
    const chunks = await collect(renderServerComponent(Bound, { frame: { id: "ta-direct" } }));
    const announced = chunks.filter(c => c.tiers);
    expect(announced.length).toBe(1);
    expect(announced[0].tiers).toEqual(["bind"]);
    // On the first emission after the read: the slot chunk left at the
    // call, the property read came after it, so the shell's html — the
    // chunk that carries the `_s:` marker — is what announces it.
    expect(announced[0].type).toBe("html");
    expect(announced[0].html).toContain('_s:class="row#0:cls"');
  });
});

describe("tier announcement — document face", () => {
  it("announces nothing when nothing is minted: no record, no link", async () => {
    const Inline = frameTransformDirectResult(Plain, {
      id: "td-none",
      tierUrls: { bind: "/tier-bind.js" }
    }) as any;
    const html = await document(() => Inline({ children: () => <i>client</i> }));
    expect(html).toContain("<h1>Story</h1>");
    expect(tiersRecord(html)).toBeUndefined();
    expect(html).not.toContain("modulepreload");
  });

  it("`bind`: the record names it; a `modulepreload` for the given URL joins the head", async () => {
    const Inline = frameTransformDirectResult(Bound, {
      id: "td-bind",
      tierUrls: { bind: "/assets/tier-bind.js" }
    }) as any;
    const html = await document(() => (
      <html>
        <head>
          <title>t</title>
        </head>
        <body>{Inline({ row: () => ({ cls: "x" }) })}</body>
      </html>
    ));
    expect(tiersRecord(html)).toEqual(["bind"]);
    expect(html).toContain('<link rel="modulepreload" href="/assets/tier-bind.js">');
    // In the head, with the shell.
    expect(html.indexOf("modulepreload")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain('_s:class="row#0:cls"');
  });

  it("without `tierUrls` the record alone announces the name — no link", async () => {
    const Inline = frameTransformDirectResult(Bound, { id: "td-nourl" }) as any;
    const html = await document(() => Inline({ row: () => ({ cls: "x" }) }));
    expect(tiersRecord(html)).toEqual(["bind"]);
    expect(html).not.toContain("modulepreload");
  });

  it("`regions` and `trace`: minted by the document slot props, cumulative across components", async () => {
    const R = frameTransformDirectResult(Regioned, { id: "td-reg" }) as any;
    const T = frameTransformDirectResult(Traced, { id: "td-tr" }) as any;
    const html = await document(() => [
      R({ panel: (p: any) => <div>{p.body}</div> }),
      T({ row: (p: any) => <b>{p.data.n}</b> })
    ]);
    // The last write is the complete set; the first component's tier is
    // not lost to the second's.
    expect(tiersRecord(html)).toEqual(["regions", "trace"]);
    expect(html).toMatch(/_\$HY\.r\["sc:tiers"\]=(?:\$R\[\d+\]=)?\["regions"\]/);
  });

  it("`wire`: an inline `live` answer announces the wire tier", async () => {
    const Inline = frameTransformDirectResult(Plain, { id: "td-wire" }) as any;
    // The in-process `live` declaration's brand (server-functions' `brandLive`).
    Inline[Symbol.for("solid.LiveSource")] = true;
    const html = await document(() => Inline({ children: () => <i>c</i> }));
    expect(tiersRecord(html)).toEqual(["wire"]);
  });

  it("a sync render (renderToString) announces nothing — the client detects", () => {
    const Inline = frameTransformDirectResult(Bound, { id: "td-sync" }) as any;
    const html = renderToString(() => Inline({ row: () => ({ cls: "x" }) }), {
      plugins: [ServerComponentPlugin]
    } as any);
    expect(html).toContain('_s:class="row#0:cls"');
    expect(tiersRecord(html)).toBeUndefined();
  });
});
