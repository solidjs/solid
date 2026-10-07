/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C16 — one component identity per function.
 *
 * "A server-function call resolves, on every path — the document's
 * hydration reference, the transport's post-load answer, a flight reference
 * in a mutation envelope, a re-call after an address switch — to a binding
 * whose mount component is the same object, so a `dynamic` site never
 * remounts across hydration and navigation."
 *
 * Mechanism meant to carry it: frames/src/frame-transport.ts
 * `createServerComponentHandler` (`componentFor` — one component per
 * function, `bindingFor` — one binding per address, `stage`'s token
 * binding, `settled`, `showing`, `resolveServerComponent`),
 * frames/src/client.ts `installServerComponents` (`_$SC.r` and its `c`/`b`
 * tables; `component: fnId => _$SC.r(fnId)` makes the transport's component
 * THE document placeholder), web/src/index.ts `dynamic` (`bindingOf`,
 * `resolveBinding`, `sameInstance`, `deliveredAddress`).
 *
 * Identity is read two ways: `COMPONENT_BINDING.component` on every
 * resolution (must be `_$SC.r(fid)`), and the mounted `<solid-frame>`
 * element (must be the same node through every resolution). The document
 * face adopts the SSR'd element; no fill is involved, so the mounts are
 * plain roots (a fill's claim is C1/C10's business).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, Loading, type Component } from "solid-js";
import { dynamic, dynamicComponent, hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import {
  COMPONENT_BINDING,
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  flightCodec
} from "../../frames/src/frame-transport.js";
import { createServerReference } from "../../server-functions/src/client.js";
import {
  ChunkReader,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  frameAddress,
  serializeStream,
  subscribeFlightData
} from "../../server-functions/src/shared.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  pump,
  quiesce,
  stubHeldFetch,
  type Page
} from "./support.js";

const componentOf = (binding: any) => binding && binding[COMPONENT_BINDING]?.component;
const addressOf = (binding: any) => binding && binding[COMPONENT_BINDING]?.address;

const chunks = (id: string, version: number, text: string) => [
  { type: "start", id, version },
  { type: "html", id, version, html: `<h1>${text}</h1>` },
  { type: "complete", id, version }
];

/** A flight reference as the server's transform serializes one. */
function flightReference(id: string, address: string) {
  const reference: any = () => undefined;
  reference[SERVER_COMPONENT] = id;
  reference[SERVER_COMPONENT_ADDRESS] = address;
  return reference;
}

/** A held single-flight response: regions first, then the envelope. */
function openFlightResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: c => void (controller = c) });
  return {
    response: new Response(body, {
      headers: {
        "Content-Type": "application/x-frame-stream",
        "X-Frame-Stream": "",
        [SINGLE_FLIGHT_HEADER]: "true"
      }
    }),
    send: (chunk: any) => controller.enqueue(createChunk(JSON.stringify(chunk))),
    async outcome(envelope: unknown) {
      const reader = new ChunkReader(serializeStream(envelope, flightCodec(undefined)));
      for (let node = await reader.next(); !node.done; node = await reader.next())
        controller.enqueue(createChunk(JSON.stringify({ type: "outcome", payload: node.value })));
    },
    close: () => controller.close()
  };
}

let page: Page | undefined;
const disposers: (() => void)[] = [];
const unsubscribes: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  for (const u of unsubscribes.splice(0)) u();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

// Both entry points: `dynamic` and its component-only sibling
// `dynamicComponent` share one implementation (`bindingOf`, `sameInstance`,
// the delivery into mounted sites included); the sibling is the documented
// server-component mount, so the rule is pinned on it by name.
type Dyn = (source: () => any) => Component<any>;
const VIA: ReadonlyArray<[string, Dyn]> = [
  ["dynamic", dynamic],
  ["dynamicComponent", dynamicComponent]
];

/**
 * A site over `source`. The document face hydrates INTO `container` (the
 * shell is the bare `<solid-frame>`); the dom face mounts a fresh root under
 * a `<Loading>`, appended to `container`.
 */
function mountSite(dyn: Dyn, source: () => unknown, container: Element, face: "document" | "dom") {
  const Site = dyn(() => source() as any);
  let div: Element = container;
  if (face === "document") {
    disposers.push(
      hydrate(
        () => (
          <Loading fallback={<span>fallback</span>}>
            <Site />
          </Loading>
        ),
        container
      )
    );
  } else {
    disposers.push(
      createRoot(d => {
        <div ref={el => (div = el)}>
          <Loading fallback={<span>fallback</span>}>
            <Site />
          </Loading>
        </div>;
        container.appendChild(div);
        return d;
      })
    );
  }
  return {
    get div() {
      return div;
    },
    frame: () => div.querySelector("solid-frame"),
    h1: () => div.querySelector("h1")?.textContent
  };
}

describe.each(VIA)("C16 — one component identity per function — via %s", (_via, dyn) => {
  // Arms (a), (b), (d) on one document page: the hydration reference
  // (`_$SC.r(fid, A)`) mounts first and adopts the SSR'd element; then a
  // refetch of A (staged — the site shows A), a switch to B, a re-call of A.
  test("(a)(b)(d) document reference → refetch → args switch → re-call: one component, one element", async () => {
    const fid = freshFid("c16a");
    const A = frameAddress(fid, [1]);
    const B = frameAddress(fid, [2]);
    // The document carries the element under the WIRE name (the function
    // id); the reference carries the call's address.
    page = bootPage(frameHtml(fid, "<h1>doc</h1>"));
    // What the hydration data hands a cache: the addressed reference.
    const docRef = (globalThis as any)._$SC.r(fid, A);
    const placeholder = (globalThis as any)._$SC.r(fid);
    expect(componentOf(docRef)).toBe(placeholder);
    expect(addressOf(docRef)).toBe(A);
    // Post-adoption calls go to the wire: A (refetch), B (switch), A again.
    const { held, calls } = stubHeldFetch([fid, fid, fid]);
    const getX = createServerReference(fid);
    const [n, setN] = createSignal(0);
    const resolutions: Promise<unknown>[] = [];
    const source = () => {
      const i = n();
      if (i === 0) return docRef;
      const call = getX(i === 1 || i === 3 ? 1 : 2) as any;
      resolutions.push(Promise.resolve(call));
      return call;
    };
    const site = mountSite(dyn, source, page.container, "document");
    await quiesce();
    await quiesce();
    const el = site.frame()!;
    expect(el).not.toBeNull();
    expect(site.h1()).toBe("doc");
    expect(calls.length).toBe(0);

    // (a) Refetch of the shown address: staged; the call resolves to the
    // token binding — same component — and the site keeps its element.
    setN(1);
    await pump();
    expect(calls.length).toBe(1);
    for (const c of chunks(fid, 1, "A2")) held[0].send(c);
    held[0].close();
    await pump(3);
    const refetched: any = await resolutions[0];
    expect(componentOf(refetched)).toBe(placeholder);
    expect(site.frame()).toBe(el);
    expect(site.h1()).toBe("A2");

    // (b) Args switch: a new address, the same component; the element
    // stands and B's content morphs into it.
    setN(2);
    await pump();
    expect(calls.length).toBe(2);
    const switched: any = await resolutions[1];
    expect(componentOf(switched)).toBe(placeholder);
    expect(addressOf(switched)).toBe(B);
    for (const c of chunks(fid, 1, "B1")) held[1].send(c);
    held[1].close();
    await pump(3);
    expect(site.frame()).toBe(el);
    expect(site.h1()).toBe("B1");

    // (d) Re-call of A after the switch: A's binding is the one object the
    // transport minted for the address; the element stands; A's warm store
    // re-materializes and the new stream morphs it.
    setN(3);
    await pump();
    expect(calls.length).toBe(3);
    const recalled: any = await resolutions[2];
    expect(componentOf(recalled)).toBe(placeholder);
    expect(addressOf(recalled)).toBe(A);
    expect(site.frame()).toBe(el);
    expect(site.h1()).toBe("A2");
    for (const c of chunks(fid, 1, "A3")) held[2].send(c);
    held[2].close();
    await pump(3);
    expect(site.frame()).toBe(el);
    expect(site.h1()).toBe("A3");
    // One adoption, no fresh frame, nothing logged.
    expect(page.container.querySelectorAll("solid-frame").length).toBe(1);
    expect(page.errors).toEqual([]);
    expect(page.warnings).toEqual([]);
  });

  // Arm (c): a flight reference inside a mutation's envelope resolves to
  // the call's binding through `resolveServerComponent` — the same
  // component as the document placeholder and the transport's own
  // binding — so a site switching from the transport's answer to the
  // envelope's value keeps its instance.
  test("(c) a flight reference in a mutation envelope resolves to the same component; the instance stands", async () => {
    const fid = freshFid("c16c");
    const A = frameAddress(fid, []);
    installServerComponents();
    const placeholder = (globalThis as any)._$SC.r(fid);
    const getX = createServerReference(fid);
    const mutate = createServerReference(`${fid}/mutate`);
    const { held } = stubHeldFetch([fid]);
    const flight = openFlightResponse();
    let fetches = 0;
    const baseFetch = (globalThis as any).fetch;
    vi.stubGlobal("fetch", async (input: any, init: any) =>
      ++fetches === 1 ? baseFetch(input, init) : flight.response
    );
    // An integration's cache: the call's value, seeded by the mutation.
    const [cache, setCache] = createSignal<{ list?: unknown }>({});
    unsubscribes.push(
      subscribeFlightData((slice: any) => {
        setCache({ list: slice.list });
      })
    );
    const list = createRoot(() => createMemo(() => (cache().list ?? getX()) as any));
    const site = mountSite(dyn, () => list(), document.body, "dom");
    await pump();
    for (const c of chunks(fid, 1, "v1")) held[0].send(c);
    held[0].close();
    await pump(3);
    const el = site.frame()!;
    expect(site.h1()).toBe("v1");
    const transportBinding = list();
    expect(componentOf(transportBinding)).toBe(placeholder);

    const result = mutate();
    await pump(3);
    expect(fetches).toBe(2);
    for (const c of chunks(fid, 2, "v2")) flight.send(c);
    await flight.outcome({ value: "ok", data: { true: { list: flightReference(fid, A) } } });
    flight.close();
    await expect(result).resolves.toBe("ok");
    await pump(3);
    const flightBinding = cache().list as any;
    expect(flightBinding).toBeDefined();
    expect(componentOf(flightBinding)).toBe(placeholder);
    // The region landed in the SAME element — the site never remounted.
    expect(site.frame()).toBe(el);
    expect(site.h1()).toBe("v2");
    expect(site.div.querySelectorAll("solid-frame").length).toBe(1);
  });
});
