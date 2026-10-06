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
import { createRoot, createSignal, Loading } from "solid-js";
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

function mountSite(getX: (...args: any[]) => unknown) {
  const [n, setN] = createSignal(1);
  const Site = dynamic(() => getX(n()) as any);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>{FALLBACK}</span>}>
        <Site />
      </Loading>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  const watch = watchFrames(div);
  const pending = () => !!div.querySelector("span");
  const h1 = () => div.querySelector("h1")?.textContent;
  return { div, frames: watch.frames, pending, h1, setN };
}

describe("C17 — the shell gate answers only to the bound address", () => {
  // Arm (a): A's stream is held open after its header (the mount gate is
  // armed, the fallback shows); the site switches to B (B's header
  // resolved and the switch delivered — the second request is out); then
  // A's late html and complete arrive. The boundary must stay pending
  // until B's first chunk (its `start` — "the new address's first write").
  //
  // Observed on `next`: A's late html RELEASES the gate — the fallback goes
  // and the site shows "A" (frames: `waiting` → `A` → `B`); the frame
  // element carries B's address by the time the flush is over, and B's
  // html later morphs it to "B". Expected: `waiting` → `B`, the boundary
  // pending throughout A's late chunks. Where it goes wrong: client.ts
  // `followAddress` re-arms the gate in its COMPUTE half (and registers the
  // frameless waiter under B) but defers `frame.rebind(B)` to its EFFECT
  // half — display, run at the commit — and that run is stashed behind the
  // very gate the boundary is pending on (A had sent no content, so the
  // mount gate never released). The frame therefore stays registered under
  // A when A's html lands: `createFrameHost.apply` fans it to the frame,
  // `#flush` → `onApply`, and `boundaryComponent`'s `onApply` calls
  // `settle()` unconditionally — `release` is by then the RE-ARMED gate's
  // resolver, so A's apply releases B's gate. The released hold then runs
  // the stashed `rebind(B)` and the element reaches the document with A's
  // root in it. The gate's "first apply of the bound address" is really
  // "first apply reaching the frame", and the frame's address lags the
  // binding by one commit; `rebind`'s root-record drop ("no stale shell to
  // re-apply") runs only after the damage.
  test.fails(
    "(a) switch delivered while A is open: A's late html/complete leave the gate pending; B's first chunk releases it",
    async () => {
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
      // B's first chunk releases the gate; B's html is what the site shows.
      b.send(start);
      await pump(1);
      expect(site.pending()).toBe(false);
      b.send(html("B"));
      b.send(complete);
      b.close();
      await pump();
      expect(site.h1()).toBe("B");
      // The site never showed A.
      expect(site.frames.some(f => f.includes("A"))).toBe(false);
    }
  );

  // Arm (b): an `error` record on B is an apply — it releases the gate
  // (the frame's error state surfaces instead of a fallback held forever).
  // A stays silent so the error is the only candidate release, and the
  // error is B's FIRST chunk (a `start` would already count as B's first
  // write and release the gate on its own — see arm (a)).
  test("(b) switch while A is open and silent: an error record as B's first chunk releases the gate", async () => {
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
    expect(site.h1()).toBeUndefined();
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
  // Observed on `next`: after A's html the fallback still shows (the value
  // memo pends on B's flight; the element is detached); at B's header the
  // site shows "A" with the fallback gone (frames: `waiting` → `A` → `B`),
  // and only B's html replaces it. Expected: `waiting` → `B` — the switch
  // re-pends the boundary, which was in its fallback, until B's first
  // write. Where it goes wrong: A's `onApply` released the mount gate
  // legitimately (the mount was bound to A), so the `boundaryComponent`
  // gate memo already HOLDS the element when B is delivered;
  // `followAddress`'s compute re-arms it (`setGatePromise(arm())`), and
  // under async-holds-latest a memo that re-pends WITH a value keeps
  // showing that value — the element with A's root — so the <Loading>
  // boundary drops its fallback for content that was never on screen. The
  // rebind (effect half) is again stashed behind the re-armed gate; B's
  // `start` reaches only the frameless waiter and settles the gate, the
  // rebind then seeds from B's store, and B's html morphs A's root away.
  // (Scope note: the gate's RESOLUTION here is per C17; the breach is the
  // re-pend revealing the previous address — if the maintainer rules that
  // holds-latest behaviour, this arm belongs to a display invariant, not
  // C17.)
  test.fails(
    "(c) A's html arrives while B's header is pending: the delivery of B re-pends the boundary until B's first write, never showing A",
    async () => {
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
    }
  );

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
