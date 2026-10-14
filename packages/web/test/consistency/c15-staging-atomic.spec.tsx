/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C15 — a staged refetch lands at the commit, whole.
 *
 * "A refetch of an address a mount is showing never shows its content
 * beside siblings a transaction still holds: slot args preview into the
 * live fills in the pass that delivered the token, and markup, store,
 * mounts and regions land at that transaction's commit — never when the
 * body finishes arriving."
 *
 * Mechanism meant to carry it: frames/src/frame-transport.ts
 * `createServerComponentHandler.handle` (`host.get(address)` → `stage`),
 * `stage` (`chunks` buffered, `preview`/`commit` halves, the token binding),
 * `stagedContent`, frames/src/client.ts `followAddress` (the compute half
 * previews, the effect half commits at the delivering transaction's
 * commit), frames/src/frame-client.ts `FrameImpl.preview`.
 *
 * Shape (frames-morph-in-transition.spec.tsx's): a site shows v1 beside a
 * sibling `<b>` whose value is a memo that goes async when the same write
 * moves it (`heldSibling`); an action moves both; the refetch's body and
 * the sibling's release are ordered both ways. A MutationObserver records
 * every distinct `sibling|root|fill` frame: a torn frame pairs a new value
 * with an old one.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { action, createMemo, createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { freshFid, makeHost, pump, slotRange, stubHeldFetch, watchFrames } from "./support.js";

const response = (id: string, version: number, text: string, arg: string) => [
  { type: "start", id, version },
  { type: "slot", id, version, key: "item#0", args: { text: arg } },
  { type: "html", id, version, html: `<p>${text}</p><ul>${slotRange("item#0")}</ul>` },
  { type: "complete", id, version }
];

/** `other` is "a0" until `step` moves, then pending until `release()`. */
function heldSibling(step: () => number) {
  let release!: () => void;
  const other = createRoot(() =>
    createMemo(() => {
      const n = step();
      return n === 0 ? "a0" : new Promise<string>(r => (release = () => r(`a${n}`)));
    })
  );
  return { other, release: () => release() };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

/**
 * One site: `<b>{other()}</b>` beside the server component under a
 * `<Loading>`; the fill under `item` records every arg it reads. `view()` is
 * the `sibling|root|fill` triple; `frames` every distinct one observed.
 */
function setup(label: string) {
  const id = freshFid(label);
  const { host } = makeHost();
  installServerComponents(host);
  const { held, calls } = stubHeldFetch([id, id]);
  const [v1, v2] = held;
  const getList = createServerReference(id);
  const [tick, setTick] = createSignal(0);
  // `refetch` re-asks the call WITHOUT moving the sibling (the control).
  const [refetch, setRefetch] = createSignal(0);
  const list = createRoot(() => createMemo(() => (tick(), refetch(), getList() as any)));
  const sibling = heldSibling(tick);
  const List = dynamic(() => list());
  const seen: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const applied: string[] = [];
  container.addEventListener("frame:applied", (e: any) => applied.push(e.detail?.reason ?? "?"));
  const dispose = createRoot(d => {
    container.appendChild(
      (
        <div>
          <b>{sibling.other()}</b>
          <Loading fallback={<span>fallback</span>}>
            <List
              item={(p: { text: string }) => {
                createMemo(() => seen.push(p.text));
                return <li>{p.text}</li>;
              }}
            />
          </Loading>
        </div>
      ) as Node
    );
    return d;
  });
  disposers.push(dispose);
  const view = () =>
    [
      container.querySelector("b")!.textContent,
      container.querySelector("p")?.textContent ?? "-",
      container.querySelector("li")?.textContent ?? "-"
    ].join("|");
  const watch = watchFrames(container, view);
  return {
    id,
    host,
    v1,
    v2,
    calls,
    setTick,
    setRefetch,
    sibling,
    seen,
    view,
    applied,
    frames: watch.frames,
    sample: watch.sample
  };
}

/** Frames pairing a new value with an old one. */
const torn = (frames: string[]) =>
  frames.filter(f => {
    const [b, p, li] = f.split("|");
    const news = [b === "a1", p === "v2", li === "two"];
    return news.some(Boolean) && !news.every(Boolean);
  });

async function showV1(s: ReturnType<typeof setup>) {
  await pump();
  for (const c of response(s.id, 1, "v1", "one")) s.v1.send(c);
  s.v1.close();
  await pump();
  expect(s.view()).toBe("a0|v1|one");
  expect(s.seen).toEqual(["one"]);
  s.applied.length = 0;
  // Frames are recorded from the shown state on.
  s.frames.splice(0);
  s.sample();
}

describe("C15 — a staged refetch lands at the commit, whole", () => {
  // Arm (a): the body completes while the sibling is still held. Nothing of
  // v2 — root, slot args, store, `frame:applied` — may show before the
  // sibling releases; then everything lands in one frame.
  test("(a) body first, sibling released after: root, fill and sibling change in one frame", async () => {
    const s = setup("c15a");
    await showV1(s);
    action(function* () {
      s.setTick(1);
    })();
    await pump(3);
    expect(s.calls.length).toBe(2);
    for (const c of response(s.id, 2, "v2", "two")) s.v2.send(c);
    s.v2.close();
    await pump(3);
    // Held: nothing of v2 is visible, applied, or pushed.
    expect(s.view()).toBe("a0|v1|one");
    expect(s.applied).toEqual([]);
    expect(s.host.get(s.id)?.version).toBe(1);
    s.sibling.release();
    await pump(3);
    s.sample();
    expect(s.view()).toBe("a1|v2|two");
    expect(torn(s.frames)).toEqual([]);
    expect(s.frames).toEqual(["a0|v1|one", "a1|v2|two"]);
    // The fill was updated in place (no re-call) and read "two" exactly
    // once — the preview pushed under the transaction, not at body end.
    expect(s.seen).toEqual(["one", "two"]);
  });

  // Arm (b): the sibling releases FIRST; the body is still open. The
  // transaction stays open on the pending refetch (the staged call settles
  // at body end), so the sibling's new value waits too; then one frame.
  test("(b) sibling released first, body after: still one frame", async () => {
    const s = setup("c15b");
    await showV1(s);
    action(function* () {
      s.setTick(1);
    })();
    await pump(3);
    expect(s.calls.length).toBe(2);
    s.sibling.release();
    await pump(3);
    expect(s.view()).toBe("a0|v1|one");
    // Part of the body (start + slot + html), still open.
    const [start, slot, html, complete] = response(s.id, 2, "v2", "two");
    s.v2.send(start);
    s.v2.send(slot);
    s.v2.send(html);
    await pump(3);
    expect(s.view()).toBe("a0|v1|one");
    expect(s.applied).toEqual([]);
    s.v2.send(complete);
    s.v2.close();
    await pump(3);
    s.sample();
    expect(s.view()).toBe("a1|v2|two");
    expect(torn(s.frames)).toEqual([]);
    expect(s.frames).toEqual(["a0|v1|one", "a1|v2|two"]);
    expect(s.seen).toEqual(["one", "two"]);
  });

  // Arm (c): a SECOND refetch supersedes the first while the first is
  // staged and the sibling is held: the first's content never lands; the
  // second's lands whole with the sibling.
  test("(c) a superseding refetch while staged: only the newest lands, whole", async () => {
    const id = freshFid("c15c");
    const { host } = makeHost();
    installServerComponents(host);
    const { held, calls } = stubHeldFetch([id, id, id]);
    const [v1, v2, v3] = held;
    const getList = createServerReference(id);
    const [tick, setTick] = createSignal(0);
    const list = createRoot(() => createMemo(() => (tick(), getList() as any)));
    const sibling = heldSibling(tick);
    const List = dynamic(() => list());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = createRoot(d => {
      container.appendChild(
        (
          <div>
            <b>{sibling.other()}</b>
            <Loading fallback={<span>fallback</span>}>
              <List item={(p: { text: string }) => <li>{p.text}</li>} />
            </Loading>
          </div>
        ) as Node
      );
      return d;
    });
    disposers.push(dispose);
    const view = () =>
      [
        container.querySelector("b")!.textContent,
        container.querySelector("p")?.textContent ?? "-",
        container.querySelector("li")?.textContent ?? "-"
      ].join("|");
    const watch = watchFrames(container, view);
    await pump();
    for (const c of response(id, 1, "v1", "one")) v1.send(c);
    v1.close();
    await pump();
    expect(view()).toBe("a0|v1|one");
    watch.frames.splice(0);
    watch.sample();
    action(function* () {
      setTick(1);
    })();
    await pump(3);
    expect(calls.length).toBe(2);
    for (const c of response(id, 2, "v2", "two")) v2.send(c);
    v2.close();
    await pump(3);
    expect(view()).toBe("a0|v1|one");
    // The second write, inside its own action, while the first is held.
    action(function* () {
      setTick(2);
    })();
    await pump(3);
    expect(calls.length).toBe(3);
    for (const c of response(id, 3, "v3", "three")) v3.send(c);
    v3.close();
    await pump(3);
    expect(view()).toBe("a0|v1|one");
    sibling.release();
    await pump(3);
    watch.sample();
    expect(view()).toBe("a2|v3|three");
    expect(watch.frames.some(f => f.includes("v2") || f.includes("two"))).toBe(false);
    expect(watch.frames).toEqual(["a0|v1|one", "a2|v3|three"]);
  });

  // Arm (e) — the gap #3844 named, pinned by name. A refetch resolving to
  // the address the mount SHOWS is a write only the content token carries
  // (`dynamic` delivers a kept resolution only when its address differs, so
  // the bare address would be a `setAddress` no-op and nothing of the
  // frame's graph would run in the transaction); and the fill's derivation
  // must read the NEW arg in the pass that delivers it — not at the commit,
  // one flush behind an optimistic intent it dissolves (principles §9.2.2,
  // `frames-optimistic-hold`). So, with the body complete and the sibling
  // still held: the fill HAS derived "two" (the staged read happened in the
  // transaction's pass) while nothing shows, applies or versions it; the
  // release lands the whole in one frame. Any carrier of the staging —
  // the push (`preview`) or a pull — must keep both halves.
  test("(e) the gap (#3844): a same-address refetch enters the transaction — the fill derives the new arg in its pass, the DOM holds, the commit lands whole", async () => {
    const s = setup("c15e");
    await showV1(s);
    action(function* () {
      s.setTick(1);
    })();
    await pump(3);
    expect(s.calls.length).toBe(2);
    for (const c of response(s.id, 2, "v2", "two")) s.v2.send(c);
    s.v2.close();
    await pump(3);
    // The fill's derivation ran with the new arg in the transaction's pass…
    expect(s.seen).toEqual(["one", "two"]);
    // …while nothing of v2 is shown, applied, or versioned.
    expect(s.view()).toBe("a0|v1|one");
    expect(s.applied).toEqual([]);
    expect(s.host.get(s.id)?.version).toBe(1);
    s.sibling.release();
    await pump(3);
    s.sample();
    expect(s.view()).toBe("a1|v2|two");
    expect(torn(s.frames)).toEqual([]);
    expect(s.frames).toEqual(["a0|v1|one", "a1|v2|two"]);
    // Read exactly once, in the pass — never again at the commit.
    expect(s.seen).toEqual(["one", "two"]);
  });

  // Control: a refetch that moves NO sibling (a different signal re-asks
  // the call). The staged content lands when the staged call settles — at
  // body end — whole: root and fill in one frame.
  test("(control) a refetch holding nothing else lands at body end, whole", async () => {
    const s = setup("c15d");
    await showV1(s);
    s.setRefetch(1);
    await pump(3);
    expect(s.calls.length).toBe(2);
    const [start, slot, html, complete] = response(s.id, 2, "v2", "two");
    s.v2.send(start);
    s.v2.send(slot);
    s.v2.send(html);
    await pump(3);
    // Open body: staged, nothing shown.
    expect(s.view()).toBe("a0|v1|one");
    expect(s.applied).toEqual([]);
    s.v2.send(complete);
    s.v2.close();
    await pump(3);
    s.sample();
    expect(s.view()).toBe("a0|v2|two");
    expect(s.frames).toEqual(["a0|v1|one", "a0|v2|two"]);
    expect(s.seen).toEqual(["one", "two"]);
  });
});
