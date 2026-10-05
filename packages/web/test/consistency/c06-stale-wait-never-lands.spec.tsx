/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C6 — a held record never lands on content it no longer belongs to.
 *
 * "A record held on an unresolved `{$ref}` (or a late document record) is
 * applied only while the frame still shows the response that carried it;
 * after an address switch, a refetch that supersedes it, or disposal during
 * the wait, it never mounts or updates a fill."
 *
 * Mechanism meant to carry it: frames/src/frame-client.ts
 * `FrameImpl.#syncSlots` (the `#refsUnresolved` skip — "the stream's own
 * next flush retries"), `FrameImpl.rebind` (`#resetStreamState(true)` →
 * `clearStreamRecords` drops seg/hole/attr/:error and the root but KEEPS
 * `slot:*`; `#resolveRef` then routes by the frame's NEW id),
 * `FrameImpl.dispose`, client.ts `followAddress.drop`.
 *
 * The production shared host is under test (`installServerComponents()`):
 * the pin is about which response's data answers a held record, and only
 * the shared host has per-address tables. A's and B's records use SWAPPED
 * ref numbering (A: `{k:$ref"1", j:$ref"2"}`, B: `{k:$ref"2", j:$ref"1"}`)
 * so a cross-resolution is visible as a swapped pair, never as a value that
 * happens to coincide.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { getFrameHost, installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { createDataSource, freshFid, pump, stubHeldFetch, watchFrames } from "./support.js";

const WIRE = "srv";
const article = (title: string) =>
  `<article><h1>${title}</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`;
const start = { type: "start", id: WIRE, version: 1 };
const complete = { type: "complete", id: WIRE, version: 1 };
const html = (title: string) => ({ type: "html", id: WIRE, version: 1, html: article(title) });
const record = (k: string, j: string) => ({
  type: "slot",
  id: WIRE,
  version: 1,
  key: "comment#0",
  args: { k: { $ref: k }, j: { $ref: j } }
});
/** A's record: k ← "1", j ← "2". */
const recordA = record("1", "2");
/** B's record: k ← "2", j ← "1" (swapped numbering). */
const recordB = record("2", "1");

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

async function sharedHost() {
  installServerComponents();
  const host = getFrameHost();
  await host.prepareData();
  return host;
}

/**
 * One live site under a <Loading>: `dynamic(() => getX(n()))` (an args
 * switch is an address switch; `tick` forces a same-args refetch). The fill
 * records every `k/j` pair its prop reads yield; `frames` records every
 * distinct text the site showed.
 */
function mountSite(getX: (...args: any[]) => unknown) {
  const [n, setN] = createSignal(1);
  const [tick, setTick] = createSignal(0);
  const Site = dynamic(() => (tick(), getX(n()) as any));
  const seen: string[] = [];
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>…</span>}>
        <Site
          comment={(p: any) => {
            createMemo(() => seen.push(`${p.k}/${p.j}`));
            return <li>{`${p.k}/${p.j}`}</li>;
          }}
        />
      </Loading>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  const watch = watchFrames(div);
  return { div, seen, frames: watch.frames, setN, setTick, dispose };
}

describe("C6 — a held record never lands on content it no longer belongs to", () => {
  // Arm (a1): a switch A → B during A's `{$ref}` wait. B's stream sends its
  // data and html BEFORE its slot record (RFC 11: application is
  // order-independent, so this order is legitimate on the wire — the
  // producer normally emits the slot record before the data it references
  // and before the html). A's held record, kept across the rebind, must
  // never mount the fill with B's data.
  //
  // Observed on `next`: when B's html flushes (before B's slot record), the
  // fill MOUNTS with "jB/kB" — A's record `{k:$ref"1", j:$ref"2"}` resolved
  // against B's table — and the site shows `BjB/kB` (frames recorded:
  // `…` → `A` → `BjB/kB` → `BkB/jB`; `seen` = `["jB/kB", "kB/jB"]`) until
  // B's slot record arrives and live-updates it to "kB/jB". Expected: no
  // mount until B's own record; never the swapped pair. Where it goes wrong:
  // `FrameImpl.rebind` → `#resetStreamState(true)` → `clearStreamRecords`
  // deletes seg/hole/attr/:error and the root but KEEPS every `slot:*`
  // record (the dedupe that preserves occurrence state across a same-
  // address morph), so A's record is still the occurrence's record after
  // the frame moved to B; `#syncSlots` resolves it through `#resolveRef`,
  // which routes by the frame's NEW id → `tableFor(B)`. While B's data
  // is absent `#refsUnresolved` skips it, but B's data makes it resolvable
  // and B's html's flush applies it — a record from A's response read
  // through B's table, before B has said anything about the occurrence.
  test.fails(
    "(a1) switch during the wait, new stream orders data → html → slot: the stale record never mounts with the new data",
    async () => {
      const fid = freshFid("c6a1");
      const getX = createServerReference(fid);
      await sharedHost();
      const { held } = stubHeldFetch([WIRE, WIRE]);
      const [a, b] = held;
      const site = mountSite(getX);
      await pump();
      a.send(start);
      a.send(recordA);
      a.send(html("A"));
      await pump();
      expect(site.div.querySelector("h1")!.textContent).toBe("A");
      // A's data never arrives: the record waits.
      expect(site.seen).toEqual([]);
      site.setN(2);
      await pump();
      b.send(start);
      for (const c of createDataSource().chunks(WIRE, 1, { "2": "kB", "1": "jB" })) b.send(c);
      b.send(html("B"));
      await pump();
      expect(site.div.querySelector("h1")!.textContent).toBe("B");
      const mountedBeforeRecord = site.seen.slice();
      b.send(recordB);
      b.send(complete);
      b.close();
      await pump();
      expect(site.div.querySelector("li")!.textContent).toBe("kB/jB");
      expect(site.frames.some(f => f.includes("jB/kB"))).toBe(false);
      expect(site.seen).not.toContain("jB/kB");
      expect(mountedBeforeRecord).toEqual([]);
      expect(site.seen).toEqual(["kB/jB"]);
    }
  );

  // Arm (a2): the same switch, B ordered html → data → slot. No flush
  // happens between B's data and B's record, so the stale record is never
  // resolvable at a flush — the order the invariant claims independence
  // over is what decides (compare a1).
  test("(a2) switch during the wait, new stream orders html → data → slot: the stale record never mounts", async () => {
    const fid = freshFid("c6a2");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [a, b] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    a.send(recordA);
    a.send(html("A"));
    await pump();
    expect(site.seen).toEqual([]);
    site.setN(2);
    await pump();
    b.send(start);
    b.send(html("B"));
    await pump();
    for (const c of createDataSource().chunks(WIRE, 1, { "2": "kB", "1": "jB" })) b.send(c);
    await pump();
    expect(site.seen).toEqual([]);
    b.send(recordB);
    b.send(complete);
    b.close();
    await pump();
    expect(site.div.querySelector("li")!.textContent).toBe("kB/jB");
    expect(site.frames.some(f => f.includes("jB/kB"))).toBe(false);
    expect(site.seen).toEqual(["kB/jB"]);
  });

  // Arm (b): a REFETCH of the same address during the wait (the staged path,
  // #3759). v2 is buffered and lands at the commit with its own tables; the
  // held v1 record applies only with v1's data while v1 is what the frame
  // shows. Two placements of v1's late data: (b1) before v2's body ends
  // (v1 still shown — v1's own values are legitimate then), (b2) never /
  // after the commit (v2 shown — the held v1 record must not reach the fill
  // with v2's data).
  async function refetchDuringWait(fid: string) {
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [v1, v2] = held;
    const site = mountSite(getX);
    await pump();
    v1.send(start);
    v1.send(recordA);
    v1.send(html("A"));
    await pump();
    expect(site.seen).toEqual([]);
    // Same args again: staged behind the shown address.
    site.setTick(1);
    await pump();
    v2.send(start);
    for (const c of createDataSource().chunks(WIRE, 1, { "2": "k2", "1": "j2" })) v2.send(c);
    v2.send(recordB);
    v2.send(html("A2"));
    await pump();
    // Staged: nothing of v2 shows yet.
    expect(site.div.querySelector("h1")!.textContent).toBe("A");
    const sendLateV1 = () => {
      for (const c of createDataSource().chunks(WIRE, 1, { "1": "k1", "2": "j1" })) v1.send(c);
      v1.send(complete);
      v1.close();
    };
    const commitV2 = async () => {
      v2.send(complete);
      v2.close();
      await pump();
      expect(site.div.querySelector("h1")!.textContent).toBe("A2");
    };
    return { site, sendLateV1, commitV2 };
  }

  test("(b1) refetch during the wait, v1's late data before v2's commit: v1's record applies with v1's data (still shown), then v2 lands whole", async () => {
    const { site, sendLateV1, commitV2 } = await refetchDuringWait(freshFid("c6b1"));
    sendLateV1();
    await pump();
    // v1 is still what the frame shows: its record with its data.
    expect(site.div.querySelector("li")!.textContent).toBe("k1/j1");
    await commitV2();
    expect(site.div.querySelector("li")!.textContent).toBe("k2/j2");
    for (const swapped of ["j2/k2", "j1/k1"]) {
      expect(
        site.frames.some(f => f.includes(swapped)),
        swapped
      ).toBe(false);
      expect(site.seen).not.toContain(swapped);
    }
    expect(site.seen).toEqual(["k1/j1", "k2/j2"]);
  });

  // Observed on `next`: at v2's commit the fill is INVOKED with "j2/k2" —
  // v1's held record `{k:$ref"1", j:$ref"2"}` resolved against v2's table —
  // and the `<li>` holds "j2/k2" between two synchronous applies of the
  // commit, before v2's own record live-updates it to "k2/j2" (`seen` is
  // `["j2/k2", "k2/j2"]`; a MutationObserver sees only the final text since
  // the whole commit is one task). Expected: the fill mounts once, with
  // "k2/j2". Where it goes wrong: frame-transport.ts `stage(...).commit`
  // installs the staged tables (`data.commit()` → `tables.set(A, v2's)`)
  // BEFORE replaying the buffered chunks, and the first replayed chunk —
  // `start` — bumps the frame's version and flushes; `FrameImpl.#syncSlots`
  // still finds v1's record under `slot:comment#0` (slot records survive
  // the version bump by design), `#refsUnresolved` now answers through v2's
  // table, and the held record mounts with v2's values. `preview` cannot
  // prevent it (it only pushes into MOUNTED occurrences, and a held one is
  // not mounted), and v2's own slot record is replayed only after `start`.
  test.fails(
    "(b2) refetch during the wait, v1's data never before the commit: the held v1 record never mounts with v2's data",
    async () => {
      const { site, sendLateV1, commitV2 } = await refetchDuringWait(freshFid("c6b2"));
      await commitV2();
      expect(site.div.querySelector("li")!.textContent).toBe("k2/j2");
      // v1's stragglers after the commit: nothing of v1 reaches the fill.
      sendLateV1();
      await pump();
      expect(site.div.querySelector("li")!.textContent).toBe("k2/j2");
      for (const swapped of ["j2/k2", "j1/k1"]) {
        expect(
          site.frames.some(f => f.includes(swapped)),
          swapped
        ).toBe(false);
        expect(site.seen).not.toContain(swapped);
      }
      expect(site.seen).toEqual(["k2/j2"]);
    }
  );

  // Arm (c): disposal during the wait — later chunks never invoke the fill.
  test("(c) dispose during the wait: the record's data and the stream's end never invoke the fill", async () => {
    const fid = freshFid("c6c");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE]);
    const [a] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    a.send(recordA);
    a.send(html("A"));
    await pump();
    expect(site.div.querySelector("h1")!.textContent).toBe("A");
    expect(site.seen).toEqual([]);
    site.dispose();
    await pump();
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "kA", "2": "jA" })) a.send(c);
    a.send(complete);
    a.close();
    await pump();
    expect(site.seen).toEqual([]);
    expect(site.div.querySelector("li")).toBeNull();
  });

  // Control: the wait resolves in place, with the carrying response's data.
  test("(control) the wait resolves in place: the held record mounts with its own response's data", async () => {
    const fid = freshFid("c6ctl");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE]);
    const [a] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    a.send(recordA);
    a.send(html("A"));
    await pump();
    expect(site.seen).toEqual([]);
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "kA", "2": "jA" })) a.send(c);
    a.send(complete);
    a.close();
    await pump();
    expect(site.div.querySelector("li")!.textContent).toBe("kA/jA");
    expect(site.seen).toEqual(["kA/jA"]);
    expect(site.frames.some(f => f.includes("jA/kA"))).toBe(false);
  });
});
