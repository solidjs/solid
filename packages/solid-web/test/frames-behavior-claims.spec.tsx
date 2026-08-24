/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Behavior claims (Stage 6): server-rendered elements carry
// `_bnd="pos=prop"` markers (compiled under the `serverComponents` option
// and minted by ssrClaim from slot-props stubs). The client resolves them
// through the mounted frame's LIVE props — event positions at dispatch time
// via delegation, ref positions at materialize time via the frame's sweep.
// The server side is hand-framed Responses (marker-bearing html, exactly
// what the compiled server output produces) behind a stubbed fetch, so the
// real transport → frame → delegation pipeline is under test.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush, Loading, onCleanup } from "solid-js";
import { dynamic, render, delegateEvents } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/index.js";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { createChunk } from "@solidjs/web/server-functions/client";

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

function cardResponse(version: number) {
  // v3 swaps the label's TAG: the morph must replace the element (not patch
  // in place), which is the ref re-fire case.
  const label =
    version >= 3
      ? `<em _bnd="ref=label">Label v${version}</em>`
      : `<span _bnd="ref=label">Label v${version}</span>`;
  return frameResponse("srv", [
    { type: "start", id: "srv", version },
    {
      type: "html",
      id: "srv",
      version,
      html: `<section><button _bnd="click=onCopy">Copy v${version}</button>${label}</section>`
    },
    { type: "complete", id: "srv", version }
  ]);
}

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
    resolve: (ref: any) => table.resolve(ref),
    // Mirrors getFrameHost's production wiring: event-claim arming flows as
    // a host option, never a client.js global (subset-size contract).
    delegate: delegateEvents
  });
}

const getCard = createServerReference("card/get");

describe("behavior claims through server-component mounts", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  test("event props dispatch via _bnd, refs fire on materialize, and resolution is latest-props", async () => {
    const [card, setCard] = createSignal(1);
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = JSON.parse(String(init.body))[0];
      return cardResponse(v);
    });

    const clicks: string[] = [];
    const refs: string[] = [];
    const cleanups: string[] = [];
    // The latest-props probe: the event prop derives from a signal. Flipping
    // it must swap what dispatch resolves WITHOUT any re-render or morph —
    // the marker names the prop; the frame's live props do the rest.
    const [mode, setMode] = createSignal<"a" | "b">("a");
    const handlerA = (e: Event) => clicks.push(`a:${e.type}`);
    const handlerB = (e: Event) => clicks.push(`b:${e.type}`);

    const Card = dynamic(() => getCard(card()) as any);

    // A real mount (`render`) registers the delegated root — the sweep's
    // delegateEvents arming needs a container to attach to, exactly as in
    // an app.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <Loading fallback={<span>...</span>}>
          <Card
            onCopy={mode() === "a" ? handlerA : handlerB}
            label={(el: Element) => {
              // Capture at fire time — the element survives morphs and its
              // text moves on, but each FIRE is a distinct registration.
              const at = el.textContent!;
              refs.push(at);
              // Refs fire under the frame creator's owner: ambient lifecycle
              // works inside the callback and runs at the OWNER's disposal
              // (the frame's lifetime), not per element replacement.
              onCleanup(() => cleanups.push(at));
            }}
          />
        </Loading>
      ),
      container
    );
    const div = container;
    await cycle();

    // Materialize swept the markers: the ref prop fired with the element.
    const btn = div.querySelector("button")!;
    expect(btn.textContent).toBe("Copy v1");
    expect(refs).toEqual(["Label v1"]);

    // Dispatch resolves the click through the frame's props via delegation
    // (the sweep armed the document listener; no client handler for "click"
    // exists anywhere else in this app).
    (btn as HTMLElement).click();
    expect(clicks).toEqual(["a:click"]);

    // Latest-props: flip the signal the prop reads. No morph, same DOM node,
    // next dispatch resolves the new function.
    setMode("b");
    flush();
    (btn as HTMLElement).click();
    expect(clicks).toEqual(["a:click", "b:click"]);

    // An args change morphs new content in. The morph KEEPS the label
    // element (same tag/position; only text changed), so the ref does NOT
    // re-fire — same node, the client already holds it. Events keep
    // dispatching on the kept button.
    const label1 = div.querySelector("span")!;
    setCard(2);
    await cycle();
    const btn2 = div.querySelector("button")!;
    expect(btn2.textContent).toBe("Copy v2");
    expect(div.querySelector("span")).toBe(label1);
    expect(refs).toEqual(["Label v1"]);
    (btn2 as HTMLElement).click();
    expect(clicks).toEqual(["a:click", "b:click", "b:click"]);

    // v3 REPLACES the label (tag change): the fresh element re-sweeps and
    // the ref fires again with the new node. Morphs never ran the owner's
    // cleanups — those belong to disposal.
    setCard(3);
    await cycle();
    expect(div.querySelector("em")!.textContent).toBe("Label v3");
    expect(refs).toEqual(["Label v1", "Label v3"]);
    expect(cleanups).toEqual([]);

    dispose();
    flush();
    // Owner disposal runs every ref's registered cleanup (both fires).
    expect(cleanups).toEqual(["Label v1", "Label v3"]);
    container.remove();
  });

  test("a marker naming a prop the client never passed drops silently at dispatch", async () => {
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        {
          type: "html",
          id: "srv",
          version: 1,
          html: `<section><button _bnd="click=missing">x</button></section>`
        },
        { type: "complete", id: "srv", version: 1 }
      ])
    );
    const Card = dynamic(() => getCard(9) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <Card />, container);
    await cycle();
    const btn = container.querySelector("button")!;
    expect(() => (btn as HTMLElement).click()).not.toThrow();
    dispose();
    flush();
    container.remove();
  });
});
