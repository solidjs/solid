/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C17 — the shell gate answers only to the bound address.
 *
 * "A mount's covering boundary resolves no earlier than the first apply
 * (content or error) of the address the mount is bound to, and an address
 * switch re-pends it until the new address's first write — the previous
 * address's late chunks never release it."
 *
 * Mechanism meant to carry it: frames/src/client.ts `boundaryComponent`
 * (`applied`/`mountGate`/`settle`, `onApply`), `followAddress` (the re-arm
 * in the pass, the frameless host waiter under the new address, the
 * `rebind` in the effect half — at the delivering transaction's commit),
 * frame-client.ts `FrameImpl.rebind` (`#appliedRootValue = undefined`, the
 * root record dropped — a flush between the rebind and the new stream's
 * html finds no stale shell to re-apply).
 *
 * One `dynamic` site inside `<Loading fallback>`; the covering boundary's
 * state is read off the DOM (the fallback `<span>` present = pending), and
 * every distinct text the site showed is recorded (`watchFrames`).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, Errored, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { freshFid, heldStream, makeHost, pump, stubHeldFetch, watchFrames } from "./support.js";

const WIRE = "srv";
const start = { type: "start", id: WIRE, version: 1 };
const complete = { type: "complete", id: WIRE, version: 1 };
const html = (title: string) => ({
  type: "html",
  id: WIRE,
  version: 1,
  html: `<article><h1>${title}</h1></article>`
});
const FALLBACK = "waiting";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

// The `<Errored>` is the frame's (frames-rulings 3.3): the frame as one
// async value outward REJECTS on its `:error`, and the error throws to the
// nearest client `<Errored>` as any rejected `createAsync` does — without
// one, the core halts the reactive system. Its fallback is an `<em>`, so
// `pending` (the `<span>` fallback) still reads the <Loading> alone.
function mountSite(getX: (...args: any[]) => unknown) {
  const [n, setN] = createSignal(1);
  const Site = dynamic(() => getX(n()) as any);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Errored fallback={err => <em>{String((err() as any)?.message)}</em>}>
        <Loading fallback={<span>{FALLBACK}</span>}>
          <Site />
        </Loading>
      </Errored>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  const watch = watchFrames(div);
  const pending = () => !!div.querySelector("span");
  const h1 = () => div.querySelector("h1")?.textContent;
  const error = () => div.querySelector("em")?.textContent;
  return { div, frames: watch.frames, pending, h1, error, setN };
}

describe("C17 — the shell gate answers only to the bound address", () => {
  // Arm (a): A's stream is held open after its header (the mount pends on
  // A's landing, the fallback shows); the site switches to B (B's header
  // resolved and the switch delivered — the second request is out); then
  // A's late html and complete arrive. The boundary must stay pending
  // until B's first FLUSH — its content or error (frames-rulings 1.5: "the
  // new address's first apply"; A0 corollary 4: the frame participates in
  // `<Loading>` until its first flush). B's `start` is the response
  // announcing itself, not a landing: an empty `<solid-frame>` revealed at
  // it would be the very flash the shell gate exists to prevent.
  //
  // Was red on `next`: A's late html RELEASED the gate (frames `waiting` →
  // `A` → `B`) — the frame was still registered under A (the rebind runs
  // at the commit the boundary was holding), A's html fanned to it, and the
  // frame's `onApply` settled whatever gate was armed, the re-armed one
  // included. Green under the address source: the mount pends on
  // `host.landing(B)`, which only a write under B lands; A's writes answer
  // A's question. (The first version of this pin released the gate at
  // B's `start`, the frameless waiter's incidental behaviour.)
  test("(a) switch delivered while A is open: A's late html/complete leave the gate pending; B's first flush releases it", async () => {
    const fid = freshFid("c17a");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const { held, calls } = stubHeldFetch([WIRE, WIRE]);
    const [a, b] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    await pump(1);
    expect(site.pending()).toBe(true);
    site.setN(2);
    await pump();
    expect(calls.length).toBe(2);
    expect(site.pending()).toBe(true);
    // A's late content and end, after the switch delivered B.
    a.send(html("A"));
    a.send(complete);
    a.close();
    await pump();
    expect(site.pending()).toBe(true);
    expect(site.h1()).toBeUndefined();
    // B's `start` announces B's response: still pending (nothing of B has
    // landed). B's html is B's first flush — it releases the gate and is
    // what the site shows.
    b.send(start);
    await pump(1);
    expect(site.pending()).toBe(true);
    expect(site.h1()).toBeUndefined();
    b.send(html("B"));
    await pump();
    expect(site.pending()).toBe(false);
    expect(site.h1()).toBe("B");
    b.send(complete);
    b.close();
    await pump();
    expect(site.h1()).toBe("B");
    // The site never showed A.
    expect(site.frames.some(f => f.includes("A"))).toBe(false);
  });

  // Arm (b): an `error` record on B is the new question REJECTING
  // (frames-rulings 3.3, A7): B's landing rejects, the mount's content node
  // throws, the nearest client `<Errored>` shows the record — the gate is
  // released by the error, never by an empty frame revealed for it. A stays
  // silent so the error is the only candidate release, and the error is
  // B's FIRST chunk (a `start` would already count as B's first write and
  // release the gate on its own — see arm (a)). Re-pinned 2026-10-06 from
  // "releases the gate (the frame's error state surfaces)".
  test("(b) switch while A is open and silent: an error record as B's first chunk rejects the landing — the <Errored> shows it", async () => {
    const fid = freshFid("c17b");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [a, b] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    await pump(1);
    site.setN(2);
    await pump();
    expect(site.pending()).toBe(true);
    b.send({ type: "error", id: WIRE, version: 1, error: { message: "boom" } });
    await pump();
    expect(site.pending()).toBe(false);
    expect(site.error()).toBe("boom");
    expect(site.h1()).toBeUndefined();
    expect(site.div.querySelector("solid-frame")).toBeNull();
    expect(site.frames.some(f => f.includes("A"))).toBe(false);
    b.close();
    a.close();
  });

  // Arm (c): the order variation — A's late html arrives while B's HEADER
  // is still pending (the switch's call has not resolved). A's apply is the
  // bound address's then, but the `dynamic` value is pending on B's call,
  // so the boundary stays in its fallback; when B's binding lands the
  // switch must re-pend the boundary until B's first write — never reveal
  // A's content, which the user switched away from before it ever showed.
  //
  // Was red on `next`: A's html released the mount gate legitimately (the
  // mount was bound to A), so the gate memo already HELD the element when
  // B was delivered; the re-arm made it pend WITH a value, and under
  // async-holds-latest the boundary dropped its fallback for content that
  // was never on screen (frames `waiting` → `A` → `B`). Green under
  // frames-rulings 1.6 (i): the address source is read per bound address
  // through a FRESH node — B's landing has no value until B lands — so the
  // unrevealed boundary stays on its fallback; a value computed for A is
  // not a value for B.
  test("(c) A's html arrives while B's header is pending: the delivery of B re-pends the boundary until B's first write, never showing A", async () => {
    const fid = freshFid("c17c");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const a = heldStream(WIRE);
    const b = heldStream(WIRE);
    let releaseB!: () => void;
    const bHeader = new Promise<void>(r => (releaseB = r));
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      if (calls === 1) return a.response;
      await bHeader;
      return b.response;
    });
    const site = mountSite(getX);
    await pump();
    a.send(start);
    await pump(1);
    expect(site.pending()).toBe(true);
    site.setN(2);
    await pump();
    expect(calls).toBe(2);
    // Still bound to A (B's header is held): A's content applies to the
    // bound address, but the user has switched — it must not show.
    a.send(html("A"));
    a.send(complete);
    a.close();
    await pump();
    expect(site.pending()).toBe(true);
    expect(site.h1()).toBeUndefined();
    // B's header lands: the switch delivers; the gate re-arms for B.
    releaseB();
    await pump();
    expect(site.pending()).toBe(true);
    expect(site.h1()).toBeUndefined();
    b.send(start);
    b.send(html("B"));
    b.send(complete);
    b.close();
    await pump();
    expect(site.pending()).toBe(false);
    expect(site.h1()).toBe("B");
    expect(site.frames.some(f => f.includes("A"))).toBe(false);
  });

  // Arm (d) (control for the rebind having run): B's first chunk releases
  // the gate BEFORE A's late chunks arrive — the frame is then registered
  // under B, and A's html/complete reach only A's resident store.
  test("(d) B releases first, then A's late html/complete arrive: the site keeps B", async () => {
    const fid = freshFid("c17d");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [a, b] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    await pump(1);
    site.setN(2);
    await pump();
    b.send(start);
    b.send(html("B"));
    await pump();
    expect(site.pending()).toBe(false);
    expect(site.h1()).toBe("B");
    a.send(html("A"));
    a.send(complete);
    a.close();
    await pump();
    expect(site.h1()).toBe("B");
    b.send(complete);
    b.close();
    await pump();
    expect(site.h1()).toBe("B");
    expect(site.frames.some(f => f.includes("A"))).toBe(false);
  });

  // Control: no switch — A's html releases the gate.
  test("(control) no switch: A's first content releases the gate", async () => {
    const fid = freshFid("c17ctl");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const { held } = stubHeldFetch([WIRE]);
    const [a] = held;
    const site = mountSite(getX);
    await pump();
    a.send(start);
    await pump(1);
    expect(site.pending()).toBe(true);
    a.send(html("A"));
    await pump();
    expect(site.pending()).toBe(false);
    expect(site.h1()).toBe("A");
    a.send(complete);
    a.close();
    await pump();
    expect(site.frames).toEqual([FALLBACK, "A"]);
  });
});
