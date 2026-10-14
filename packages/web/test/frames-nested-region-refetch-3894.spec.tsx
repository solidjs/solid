/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3894: a same-argument refetch, then a new argument, must replace the
// nested server region. The server component is `region(id)` returning
// `props => <main><props.wrap><span>{id}</span></props.wrap></main>`. The
// span is server content passed into the client `wrap` slot — a `{$frame}`
// region keyed by the function id, not the call address. Refetching id 1
// and then requesting 2 must show 2 inside the nested section.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { prepareTier } from "../frames/src/frame-client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";
import { createChunk } from "../server-functions/src/shared.js";

const FN = "region";
const REGION = `${FN}.wrap#0.children`;

const settle = () => new Promise(r => setTimeout(r));

async function pump(times = 2) {
  for (let i = 0; i < times; i++) {
    flush();
    await settle();
  }
}

// The region is the regions tier's. Warmed so the first response mounts the
// nested span without racing the tier import.
beforeAll(() => prepareTier("regions"));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

function regionResponse(id: number) {
  const chunks = [
    { type: "start", id: FN, version: 1 },
    {
      type: "slot",
      id: FN,
      version: 1,
      key: "wrap#0",
      args: { children: { $frame: REGION } }
    },
    {
      type: "html",
      id: FN,
      version: 1,
      html: "<main><!--slot:wrap#0:start--><!--slot:wrap#0:end--></main>"
    },
    { type: "html", id: REGION, version: 1, html: `<span>${id}</span>` },
    { type: "complete", id: FN, version: 1 }
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, {
    headers: { "X-Frame-Stream": FN, "X-Frame-Tiers": "regions" }
  });
}

const get = createServerReference(FN);

describe("nested server region after refetch then argument change (#3894)", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mount() {
    const fetched: number[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: { body?: unknown }) => {
      const id = JSON.parse(String(init.body))[0];
      fetched.push(id);
      return regionResponse(id);
    });
    const [id, setId] = createSignal(1);
    const [version, setVersion] = createSignal(0);
    const Component = dynamic(() => {
      version();
      return get(id()) as any;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={root}>
        <Loading fallback={<b>pending</b>}>
          <Component wrap={(p: any) => <section>{p.children}</section>} />
        </Loading>
      </div>;
      container.appendChild(root);
      return d;
    });
    return {
      fetched,
      root,
      refetch: () => {
        setVersion(v => v + 1);
        flush();
      },
      change: (next: number) => {
        setId(next);
        flush();
      },
      dispose: () => {
        dispose();
        container.remove();
      }
    };
  }

  test("a refetch of the same argument then a new argument updates the nested region", async () => {
    const view = mount();
    try {
      await pump();
      expect(view.fetched).toEqual([1]);
      expect(view.root.querySelector("section")!.textContent).toBe("1");

      view.refetch();
      await pump();
      expect(view.fetched).toEqual([1, 1]);
      expect(view.root.querySelector("section")!.textContent).toBe("1");

      view.change(2);
      await pump();
      expect(view.fetched).toEqual([1, 1, 2]);
      expect(view.root.querySelector("section")!.textContent).toBe("2");
    } finally {
      view.dispose();
    }
  });

  test("an argument change with no prior refetch updates the nested region", async () => {
    const view = mount();
    try {
      await pump();
      expect(view.root.querySelector("section")!.textContent).toBe("1");
      view.change(2);
      await pump();
      expect(view.fetched).toEqual([1, 2]);
      expect(view.root.querySelector("section")!.textContent).toBe("2");
    } finally {
      view.dispose();
    }
  });
});
