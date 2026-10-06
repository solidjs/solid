/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C19 — a claim shows the value it read, and reads what the markup was
 * rendered from (frames-rulings 3.6 (iii), "the consumer parks").
 *
 * "A fill that claims adopted markup reads the state the server rendered
 * it from — a container trace's snapshot — and claims against it; what
 * moved before the claim lands after the claim as the update it is. The
 * claim pass never rewrites a hole."
 *
 * Mechanism: solid/src/client/hydration.ts `materializeContainerTrace`
 * parks a replayed backlog beyond the snapshot until hydration ends
 * (`onHydrationEnd`; the next microtask when none is in progress) and
 * creates its projection under a detached root. The shapes are S1's
 * `container-trace-hold-{snapshot, hydration-end, id-determinism}` specs
 * (`9927ddddd`) re-cut for `next`, where the late claim is the #2968
 * record defer under the frame's hold (3.1 / 3.2) rather than S1's lazy
 * materializer hold.
 *
 * Release order pinned (3.2, "ordering to pin with it"): the claim, then
 * the frame's hold release, then done, then the backlog.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush, untrack } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  microtasks,
  onHydrationEnd,
  placeholderHtml,
  quiesce,
  slotRange,
  traceMarker,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

/** A trace the server rendered at `n = snapshot` and then moved past. */
function movedTrace(snapshot: number, ...patches: number[]) {
  const trace = traceMarker();
  trace.snapshot({ n: snapshot });
  for (const n of patches) trace.patch([[["n"], n]]);
  return trace;
}

describe("C19 — a claim reads the snapshot; the backlog lands after the claim", () => {
  // (a) Resident at t=0, the trace already past the markup: the record and
  // its snapshot AND two patches are in the page before hydrate. The server
  // rendered `2`; the fill's first read is the snapshot (`2`), the claim
  // keeps the markup's text, and the backlog (`5`) lands at hydration end.
  // Was red on `next`: the fill read `5` (the materializer replayed every
  // patch at revive), the claim kept `2`, nothing healed it.
  test("(a) t=0 claim with a trace past the markup: the claim shows the snapshot, hydration end brings the fold", async () => {
    const fid = freshFid("c19a");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}</ul>`)
    );
    const trace = movedTrace(2, 3, 5);
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
    const reads: number[] = [];
    let store: any;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            store = untrack(() => p.data);
            reads.push(untrack(() => store.n));
            return <li>{p.data.n}</li>;
          }}
        />
      ),
      page.container
    );
    // The claim: the fill read the snapshot, the server's node is the node,
    // its text untouched — the claim pass rewrote nothing.
    expect(reads).toEqual([2]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(li.textContent).toBe("2");
    await quiesce();
    await quiesce();
    // Hydration over: the backlog applied as one update and the DOM caught
    // up — outside hydration, a real mutation of the claimed node.
    expect(store.n).toBe(5);
    expect(li.textContent).toBe("5");
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.warnings).toEqual([]);
    // A live patch after that is an ordinary update.
    trace.patch([[["n"], 7]]);
    flush();
    expect(li.textContent).toBe("7");
    dispose();
  });

  // (b) The late claim (the #2968 record defer under the frame's hold): the
  // parser is still running at adoption and the record arrives later; the
  // trace moves while the occurrence waits. The deferred claim runs under
  // the hold — hydration still in progress — and parks the same way: it
  // reads and keeps the snapshot, the backlog lands at hydration end.
  test("(b) deferred claim: patches during the wait land after the claim, at hydration end", async () => {
    const fid = freshFid("c19b");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}</ul>`)
    );
    const trace = movedTrace(2);
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
    const reads: number[] = [];
    let store: any;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            store = untrack(() => p.data);
            reads.push(untrack(() => store.n));
            return <li>{p.data.n}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    expect(reads).toEqual([]);
    expect(hydrationInProgress()).toBe(true);
    // The trace moves while the occurrence waits for its record.
    trace.patch([[["n"], 3]]);
    trace.patch([[["n"], 5]]);
    // The record the parser was still owed; the poll drains it and the
    // deferred mount claims.
    page.slotRecord(fid, "item#0", { data: trace.marker });
    await quiesce();
    await quiesce();
    expect(reads).toEqual([2]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(store.n).toBe(5);
    expect(li.textContent).toBe("5");
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // (c) The release order (3.2): claim → the frame's hold release → done →
  // backlog. Observed through the fill (the claim runs while hydration is
  // still in progress — the hold has not released), the end callback (the
  // store still reads the snapshot when done fires: the backlog is parked
  // past it), and the settled page (the fold).
  test("(c) release order: claim, hold release, done, backlog", async () => {
    const fid = freshFid("c19c");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}</ul>`)
    );
    const trace = movedTrace(2);
    const Comp = (globalThis as any)._$SC.r(fid);
    const li = page.container.querySelector("li")!;
    const order: string[] = [];
    let store: any;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            store = untrack(() => p.data);
            order.push(`claim:${untrack(() => store.n)}:${hydrationInProgress()}`);
            return <li>{p.data.n}</li>;
          }}
        />
      ),
      page.container
    );
    // Registered before the deferred mount parks: runs before the park's
    // own release.
    onHydrationEnd(() => order.push(`done:${store.n}:${li.textContent}`));
    await quiesce();
    trace.patch([[["n"], 5]]);
    page.slotRecord(fid, "item#0", { data: trace.marker });
    await quiesce();
    await quiesce();
    order.push(`settled:${store.n}:${li.textContent}`);
    expect(order).toEqual([
      // the claim, under the hold (hydration in progress), reads the snapshot
      "claim:2:true",
      // the hold released → done; the backlog is still parked
      "done:2:2",
      // the backlog applied; the DOM caught up
      "settled:5:5"
    ]);
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // (d) A claim AFTER hydration-done: an occurrence inside a server
  // `<Loading>` whose fragment reveals after the page's hydration completed
  // (the server's inner loading state registers nothing — corollary 4). The
  // claim parks all the same — nothing about hydration state says "claim"
  // there; the materializer parks every replayed backlog — and the backlog
  // lands on the next microtask (hydration is not in progress, so
  // `onHydrationEnd` fires at once).
  test("(d) post-done claim at a fragment's reveal: the snapshot claims, the fold lands a microtask later", async () => {
    const fid = freshFid("c19d");
    const frag = "c19d";
    page = bootPage(frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`));
    page.declareFragment(frag);
    const trace = movedTrace(2, 5);
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    const reads: number[] = [];
    let store: any;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data: { n: number } }) => {
            store = untrack(() => p.data);
            reads.push(untrack(() => store.n));
            return <li>{p.data.n}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    await quiesce();
    // Nothing to claim yet; the page is done.
    expect(reads).toEqual([]);
    expect(hydrationInProgress()).toBe(false);
    page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "2")));
    const li = page.container.querySelector("li")!;
    // The reveal is an apply (2.3): the occurrence mounted as a claim of the
    // revealed markup, reading the snapshot it was rendered from.
    expect(reads).toEqual([2]);
    expect(li.textContent).toBe("2");
    await microtasks(2);
    flush();
    expect(store.n).toBe(5);
    expect(li.textContent).toBe("5");
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // (e) Consequence pinned (contract C11, "every observable point" read as
  // "outside a claim's park"): while the park holds — hydration kept in
  // progress by ANOTHER occurrence's hold — the store reads the snapshot
  // although its oracle has the patch; the settle points after the release
  // agree with the oracle.
  test("(e) during the park the store reads the snapshot; after the release, the oracle", async () => {
    const fid = freshFid("c19e");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}${slotRange(
          "item#1",
          fillHtml(fid, "item#1", "one")
        )}</ul>`
      )
    );
    const trace = movedTrace(2, 5);
    page.slotRecord(fid, "item#0", { data: trace.marker });
    const Comp = (globalThis as any)._$SC.r(fid);
    let store: any;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { data?: { n: number }; text?: string }) => {
            const data = untrack(() => p.data);
            if (data) store = data;
            return <li>{data ? data.n : p.text}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    // item#1 waits for its record: hydration is in progress, item#0's
    // backlog is parked, the store reads the snapshot.
    expect(hydrationInProgress()).toBe(true);
    expect(store.n).toBe(2);
    page.slotRecord(fid, "item#1", { text: "one" });
    await quiesce();
    await quiesce();
    expect(hydrationInProgress()).toBe(false);
    expect(store.n).toBe(5);
    expect(page.container.textContent).toBe("5one");
    expect(page.warnings).toEqual([]);
    dispose();
  });

  // (f) Id determinism (S1's "the materializer consumes no ambient id"): a
  // keyed sibling after the frame hydrates under the same key whether or
  // not a trace was revived during the pass. The materializer's root is
  // detached; rooted under the reading owner it took one child id per
  // trace and shifted every key minted after it.
  test("(f) the materializer consumes no ambient id: a keyed sibling after the frame keys the same with and without a trace", async () => {
    const outcomes: string[] = [];
    for (const withTrace of [false, true]) {
      const fid = freshFid("c19f");
      const p = bootPage(
        frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "2"))}</ul>`) +
          `<p _hk="0">after</p>`
      );
      page = p;
      if (withTrace) {
        const trace = movedTrace(2);
        p.slotRecord(fid, "item#0", { data: trace.marker });
      } else {
        p.slotRecord(fid, "item#0", { text: "2" });
      }
      const Comp = (globalThis as any)._$SC.r(fid);
      const [label] = createSignal("after");
      const dispose = hydrate(
        () => (
          <>
            <Comp
              item={(props: { data?: { n: number }; text?: string }) => {
                const data = untrack(() => props.data);
                return <li>{data ? data.n : props.text}</li>;
              }}
            />
            <p>{label()}</p>
          </>
        ),
        p.container
      );
      await quiesce();
      const miss = p.warnings.find(w => w.includes("Hydration key miss"));
      outcomes.push(miss ? miss.match(/key miss for "([^"]+)"/)![1] : "claimed");
      dispose();
      await p.cleanup();
      page = undefined;
    }
    expect(outcomes[0]).toBe(outcomes[1]);
  });
});
