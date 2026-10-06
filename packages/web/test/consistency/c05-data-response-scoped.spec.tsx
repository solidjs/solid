/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C5 — data is response-scoped.
 *
 * "A `{$ref}` in a slot record resolves only against the data table of the
 * response that carried the record; the data of a superseded or foreign
 * response never answers it, in any arrival order of the two responses'
 * chunks."
 *
 * Mechanism meant to carry it: frames/src/client.ts `beginStream`/`tableFor`
 * (the shared host rotates one table per response at the handler's
 * `onStream`), frame-transport.ts `createServerComponentHandler.handle`
 * (`bump` + `onStream` at header time), frame-client.ts
 * `createFrameHost.apply` — a `data` chunk goes straight to `applyData` and
 * bypasses the store's version guard.
 *
 * The PRODUCTION shared host is under test (`installServerComponents()` with
 * no host): `makeHost()` has one table per test and cannot rotate. Data
 * chunks are real codec output (`createDataSource`, one serializer per
 * response). The two responses are PRELOADS of one address (an ownerless
 * `getX(1)` streams into the store unmounted — exactly an unstaged write;
 * a refetch of a SHOWN address is staged, #3759, and never rotates), with
 * held bodies so the test orders the chunks; a site mounts afterwards over
 * the preload's own promise (`dynamic(() => p1)` — no third request).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { getFrameHost, installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { frameAddress } from "../../server-functions/src/shared.js";
import { createDataSource, freshFid, pump, stubHeldFetch } from "./support.js";

const WIRE = "srv";
const ARTICLE = `<article><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`;
const start = (version: number) => ({ type: "start", id: WIRE, version });
const slot = (version: number, ref: string) => ({
  type: "slot",
  id: WIRE,
  version,
  key: "comment#0",
  args: { text: { $ref: ref } }
});
const html = (version: number) => ({ type: "html", id: WIRE, version, html: ARTICLE });
const complete = (version: number) => ({ type: "complete", id: WIRE, version });

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  // installServerComponents mirrors the document bootstrap on `_$SC`; a
  // fresh one per test (a stale one only caches per-id components, which
  // the fresh function ids below never hit).
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

/** The shared host with its codec resident (the first `data` chunk would
 *  otherwise await the lazy import — timing the test must not depend on). */
async function sharedHost() {
  installServerComponents();
  const host = getFrameHost();
  // `prepareData` takes the chunk about to decode on branches where the
  // materializer loads lazily (S1); a trace-less probe chunk warms the codec
  // alone on every branch.
  await host.prepareData({ type: "data", id: "", version: 0, node: null } as any);
  return host;
}

/**
 * Mount a site over a settled/settling call promise, under a <Loading>. The
 * fill is the contract's standard one-element fill; every value its prop
 * read yields (initial and live updates) is recorded in `seen`.
 */
function mountSite(call: Promise<unknown>) {
  const Site = dynamic(() => call as any);
  const seen: string[] = [];
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>…</span>}>
        <Site
          comment={(p: any) => {
            createMemo(() => seen.push(p.text));
            return <li>{p.text}</li>;
          }}
        />
      </Loading>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  return { container: div, seen };
}

describe("C5 — data is response-scoped", () => {
  // Arm (a): two cold streams for one address; v1's `data` for ref "1"
  // trails v2's header, v2's record references `{$ref:"1"}`, v2's own data
  // for "1" arrives later. The fill must never show v1's value.
  //
  // Observed on `next`: the fill mounts with text "old" (v1's value) and
  // stays "old" after v2's data ("new") and `complete` arrive — the frame
  // never re-resolves a record it already applied. Expected: the record
  // waits (ref unresolved) until v2's data, then shows "new".
  // Where it goes wrong: client.ts `beginStream` rotates by setting
  // `tables.set(address, undefined)` at v2's header, and `tableFor` creates
  // the table LAZILY at first use (`ensureTable`) — so v1's late `data`
  // chunk, routed by `createFrameHost.apply` straight to `applyData` with
  // no version check (the store guard only covers record writes), is the
  // first use and lands in the table that is now v2's. The transport
  // restamps chunks with the response's version but the data path never
  // reads it; nothing associates a `data` chunk with the stream that
  // carried it once the header has rotated the address's table.
  test.fails(
    "(a) v1's late data trails v2's header: v2's {$ref} never resolves to v1's value",
    async () => {
      const fid = freshFid("c5a");
      const getX = createServerReference(fid);
      await sharedHost();
      const { held } = stubHeldFetch([WIRE, WIRE]);
      const [v1, v2] = held;
      const p1 = getX(1);
      const p2 = getX(1);
      // Both headers resolved: bump(A)=1 → onStream(A); bump(A)=2 → onStream(A).
      expect(await p2).toBe(await p1);
      v1.send(start(1));
      v2.send(start(1));
      await pump(1);
      // v1's data, AFTER v2's header.
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "old" })) v1.send(c);
      await pump(1);
      // v2's record references the same ref id (ids restart per response).
      v2.send(slot(1, "1"));
      v2.send(html(1));
      await pump(1);
      const { container, seen } = mountSite(p1);
      await pump();
      // The record's ref is v2's; v2's data has not arrived: the fill waits.
      expect(seen).toEqual([]);
      expect(container.querySelector("li")).toBeNull();
      // v2's own data lands, then the stream completes.
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "new" })) v2.send(c);
      v2.send(complete(1));
      v2.close();
      await pump();
      expect(seen).not.toContain("old");
      expect(container.querySelector("li")!.textContent).toBe("new");
    }
  );

  // Arm (b): the table rotation observed directly through the host's
  // resolver (what `#refsUnresolved`/`#resolveArgs` call with the frame's
  // address) — does v1's late data land in the table v2's refs resolve
  // from, and does it overwrite v2's own value once that has landed?
  //
  // Observed on `next`: after v2's header, `resolve({$ref:"1"}, A)` reads
  // "old" from v1's late chunk (expected undefined: v2 has delivered
  // nothing); after v2's data ("new") a second late v1 chunk for "1"
  // overwrites it to "old" again (expected "new"). Where it goes wrong:
  // as in (a) — `tableFor(address)` is one table per ADDRESS at a time,
  // keyed by nothing that names the response; `createJSONDataTable.apply`
  // sets the key on every `initial` record, so whichever response's chunk
  // arrives last owns the key.
  test.fails(
    "(b) table rotation: a superseded response's late data never lands in the current table",
    async () => {
      const fid = freshFid("c5b");
      const getX = createServerReference(fid);
      const host = await sharedHost();
      const A = frameAddress(fid, [1]);
      const { held } = stubHeldFetch([WIRE, WIRE]);
      const [v1, v2] = held;
      const p1 = getX(1);
      const p2 = getX(1);
      await p1;
      await p2;
      v1.send(start(1));
      v2.send(start(1));
      await pump(1);
      expect(host.resolve({ $ref: "1" }, A)).toBeUndefined();
      // v1's late data after v2's header.
      const v1Data = createDataSource();
      for (const c of v1Data.chunks(WIRE, 1, { "1": "old" })) v1.send(c);
      await pump(1);
      const afterStaleData = host.resolve({ $ref: "1" }, A);
      // v2's data lands.
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "new" })) v2.send(c);
      await pump(1);
      expect(host.resolve({ $ref: "1" }, A)).toBe("new");
      // Another straggler from v1 (a re-serialized key) after v2's value.
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "old" })) v1.send(c);
      await pump(1);
      const afterSecondStale = host.resolve({ $ref: "1" }, A);
      expect(afterStaleData).toBeUndefined();
      expect(afterSecondStale).toBe("new");
    }
  );

  // Arm (c) (control): the normal order — v1 is complete before v2's header.
  // v1's data went to v1's table; v2's header rotates; v2's record waits for
  // v2's data and shows v2's value.
  test("(c) control: v1 completes before v2's header — v2's {$ref} resolves only to v2's data", async () => {
    const fid = freshFid("c5c");
    const getX = createServerReference(fid);
    const host = await sharedHost();
    const A = frameAddress(fid, [1]);
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [v1, v2] = held;
    const p1 = getX(1);
    await p1;
    v1.send(start(1));
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "old" })) v1.send(c);
    v1.send(slot(1, "1"));
    v1.send(html(1));
    v1.send(complete(1));
    v1.close();
    await pump();
    expect(host.resolve({ $ref: "1" }, A)).toBe("old");
    // v2's header: the table rotates; nothing of v1 is reachable.
    const p2 = getX(1);
    expect(await p2).toBe(await p1);
    v2.send(start(1));
    await pump(1);
    expect(host.resolve({ $ref: "1" }, A)).toBeUndefined();
    v2.send(slot(1, "1"));
    v2.send(html(1));
    await pump(1);
    const { container, seen } = mountSite(p1);
    await pump();
    // v2's record, no v2 data yet: the fill waits — it never reads "old".
    expect(seen).toEqual([]);
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "new" })) v2.send(c);
    v2.send(complete(1));
    v2.close();
    await pump();
    expect(seen).toEqual(["new"]);
    expect(container.querySelector("li")!.textContent).toBe("new");
  });

  // Arm (e): the same shape reached through `dynamic` alone — address
  // switches on one live site. S shows A; switch to B (cold: unstaged,
  // B's v1 body held open); switch back to A (A is cold again at the
  // handler — the frame is bound to B — so a v2 of A streams unstaged and
  // the rebind re-seeds A's warm store); switch to B again while B's v1
  // body is still open: `host.get(B)` is empty (the frame is at A), so B's
  // v2 is unstaged and its header ROTATES B's table under B's open v1
  // stream. Then B-v1's late data for "1" lands, B-v2's record references
  // "1", B-v2's own data for "1" comes last.
  //
  // Observed on `next`: the fill mounts with "old" (B-v1's value) under
  // B-v2's record and stays "old" after B-v2's data. Expected: pending until
  // B-v2's data, then "new". Where it goes wrong: as in (a) — the rotation
  // at `onStream` is per address and the data path has no version.
  test.fails(
    "(e) through dynamic: A → B → A → B while B's first body is open; B-v1's late data never answers B-v2's record",
    async () => {
      const fid = freshFid("c5e");
      const getX = createServerReference(fid);
      await sharedHost();
      // fetch order: A(v1), B(v1), A(v2), B(v2)
      const { held, calls } = stubHeldFetch([WIRE, WIRE, WIRE, WIRE]);
      const [a1, b1, a2, b2] = held;
      const [n, setN] = createSignal(1);
      const Site = dynamic(() => getX(n()) as any);
      const seen: string[] = [];
      let div!: HTMLDivElement;
      const dispose = createRoot(d => {
        <div ref={div}>
          <Loading fallback={<span>…</span>}>
            <Site
              comment={(p: any) => {
                createMemo(() => seen.push(p.text));
                return <li>{p.text}</li>;
              }}
            />
          </Loading>
        </div>;
        document.body.appendChild(div);
        return d;
      });
      disposers.push(dispose);
      await pump();
      a1.send(start(1));
      a1.send({ type: "html", id: WIRE, version: 1, html: "<article><h1>A</h1></article>" });
      a1.send(complete(1));
      a1.close();
      await pump();
      expect(div.querySelector("h1")!.textContent).toBe("A");
      // → B (v1), body held open after `start`.
      setN(2);
      await pump();
      b1.send(start(1));
      await pump(1);
      // → A again (a fresh request; A's warm store re-materializes at once).
      setN(1);
      await pump();
      a2.send(start(1));
      a2.send(complete(1));
      a2.close();
      await pump();
      expect(div.querySelector("h1")!.textContent).toBe("A");
      // → B again while b1 is still open: B's v2 header rotates B's table.
      setN(2);
      await pump();
      expect(calls.length).toBe(4);
      b2.send(start(1));
      await pump(1);
      // B-v1's late data lands after B-v2's header.
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "old" })) b1.send(c);
      await pump(1);
      // B-v2's record references "1"; its html mounts the occurrence.
      b2.send(slot(1, "1"));
      b2.send({
        type: "html",
        id: WIRE,
        version: 1,
        html: `<article><h1>B</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`
      });
      await pump();
      expect(div.querySelector("h1")!.textContent).toBe("B");
      // B-v2 has delivered no data for "1": the record waits.
      expect(seen).toEqual([]);
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "new" })) b2.send(c);
      b2.send(complete(1));
      b2.close();
      b1.close();
      await pump();
      expect(seen).not.toContain("old");
      expect(div.querySelector("li")!.textContent).toBe("new");
    }
  );

  // Arm (d): v2's data arrives FIRST, the site mounts and shows "new"; then
  // v1's late data for the same ref arrives. The mounted fill keeps "new"
  // (nothing re-resolves an applied record on a data chunk) — the DOM
  // holds here even though the table underneath has been overwritten (b).
  test("(d) v2's data first, then v1's late data: the mounted fill keeps v2's value", async () => {
    const fid = freshFid("c5d");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [v1, v2] = held;
    const p1 = getX(1);
    const p2 = getX(1);
    await p1;
    await p2;
    v1.send(start(1));
    v2.send(start(1));
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "new" })) v2.send(c);
    v2.send(slot(1, "1"));
    v2.send(html(1));
    await pump(1);
    const { container, seen } = mountSite(p1);
    await pump();
    expect(container.querySelector("li")!.textContent).toBe("new");
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "old" })) v1.send(c);
    v1.send(complete(1));
    v1.close();
    v2.send(complete(1));
    v2.close();
    await pump();
    expect(seen).toEqual(["new"]);
    expect(container.querySelector("li")!.textContent).toBe("new");
  });
});
