/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A live hole's patch over slot occurrences. The hole morph resolves slot
 * ranges against the frame's displaced-range index, as the root morph does:
 * an occurrence the new content still has keeps its range — the nodes its
 * fill rendered and the state it holds — wherever it moved; a new one
 * mounts; one the content dropped is disposed. A changed record updates the
 * mounted occurrence's props without re-invoking it.
 *
 * Deferred hydration: an adopted occurrence may still be unmounted when a
 * hole patch lands. One the patch keeps mounts claiming the markup it was
 * rendered from (its first record) and then takes the changed one; one the
 * patch drops never mounts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading, onCleanup, untrack } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { installServerComponents, setDeferredHydration } from "../../frames/src/client.js";
import { prepareTier } from "../../frames/src/frame-client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  holeHtml,
  makeHost,
  pump,
  quiesce,
  slotRange,
  stubHeldFetch,
  type Page
} from "./support.js";

// Live content applies through the live wire tier (frames/wire), which a
// live page announces and preloads; this spec sends hole ops at once, so
// it loads the tier up front.
beforeAll(() => prepareTier("wire"));

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

/** A fill that logs its invocations and cleanups, and keeps a counter of
 *  its own — state a remount would lose (`bump`, by first text). */
function makeLog() {
  return {
    invoked: [] as string[],
    cleaned: [] as string[],
    bump: {} as Record<string, () => void>
  };
}
function makeFill(log: ReturnType<typeof makeLog>) {
  return (p: { text: string }) => {
    const first = untrack(() => p.text);
    log.invoked.push(first);
    onCleanup(() => log.cleaned.push(first));
    const [count, setCount] = createSignal(0);
    log.bump[first] = () => setCount(c => c + 1);
    return (
      <button>
        {p.text}:{count()}
      </button>
    );
  };
}

const items = (...occurrences: string[]) =>
  occurrences.map(o => `<li>${slotRange(o)}</li>`).join("");
const buttons = (root: ParentNode) => [...root.querySelectorAll("button")];
const texts = (root: ParentNode) => buttons(root).map(b => b.textContent);

describe("live hole patches over slot occurrences", () => {
  test("stream face: survivors keep their nodes and state across moves, new ones mount, dropped ones dispose", async () => {
    const id = freshFid("lhs-stream");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const log = makeLog();
    const Site = dynamic(() => getX() as any);
    let div!: HTMLDivElement;
    disposers.push(
      createRoot(d => {
        <div ref={div}>
          <Loading fallback={<span>fallback</span>}>
            <Site item={makeFill(log)} />
          </Loading>
        </div>;
        document.body.appendChild(div);
        return d;
      })
    );
    await pump();
    const send = (c: any) => held[0].send({ id, version: 1, ...c });
    send({ type: "start" });
    send({ type: "slot", key: "item#0", args: { text: "a" } });
    send({ type: "slot", key: "item#1", args: { text: "b" } });
    send({ type: "html", html: `<ul>${holeHtml(0, items("item#0", "item#1"))}</ul>` });
    await pump();
    expect(texts(div)).toEqual(["a:0", "b:0"]);
    const [a, b] = buttons(div);
    log.bump.a();
    log.bump.b();
    log.bump.b();
    flush();
    expect(texts(div)).toEqual(["a:1", "b:2"]);

    // One sweep: `b`'s args change, a third occurrence arrives, and the hole
    // puts `b` first — a move across `<li>` parents.
    send({ type: "slot", key: "item#1", args: { text: "B" } });
    send({ type: "slot", key: "item#~0.2.0", args: { text: "c" } });
    send({ type: "hole", key: "lh:0", html: items("item#1", "item#0", "item#~0.2.0") });
    await pump();
    expect(texts(div)).toEqual(["B:2", "a:1", "c:0"]);
    expect(buttons(div)[0]).toBe(b);
    expect(buttons(div)[1]).toBe(a);
    expect(log.invoked).toEqual(["a", "b", "c"]);
    expect(log.cleaned).toEqual([]);

    // The hole drops two of them.
    send({ type: "hole", key: "lh:0", html: items("item#0") });
    await pump();
    expect(texts(div)).toEqual(["a:1"]);
    expect(buttons(div)[0]).toBe(a);
    expect(log.cleaned.sort()).toEqual(["b", "c"]);
    expect(log.invoked).toEqual(["a", "b", "c"]);
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
  });

  test("stream face: an occurrence moving from one hole to another in the same sweep stays mounted", async () => {
    const id = freshFid("lhs-across");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const log = makeLog();
    const Site = dynamic(() => getX() as any);
    let div!: HTMLDivElement;
    disposers.push(
      createRoot(d => {
        <div ref={div}>
          <Loading fallback={<span>fallback</span>}>
            <Site item={makeFill(log)} />
          </Loading>
        </div>;
        document.body.appendChild(div);
        return d;
      })
    );
    await pump();
    const send = (c: any) => held[0].send({ id, version: 1, ...c });
    send({ type: "start" });
    send({ type: "slot", key: "item#k", args: { text: "k" } });
    send({
      type: "html",
      html: `<ul>${holeHtml(0, items("item#k"))}</ul><ol>${holeHtml(1, "")}</ol>`
    });
    await pump();
    const k = buttons(div)[0];
    log.bump.k();
    flush();
    send({
      type: "ops",
      ops: [
        { type: "hole", key: "lh:0", html: "" },
        { type: "hole", key: "lh:1", html: items("item#k") }
      ]
    });
    await pump();
    expect(div.querySelector("ol button")).toBe(k);
    expect(texts(div)).toEqual(["k:1"]);
    expect(log.invoked).toEqual(["k"]);
    expect(log.cleaned).toEqual([]);
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
  });
});

describe("live hole patches under deferred hydration", () => {
  beforeAll(() => setDeferredHydration(true));
  afterAll(() => setDeferredHydration(false));

  test("a patch over unmounted occurrences: a kept one claims its markup then takes its new record, a dropped one never mounts", async () => {
    // The document is still loading: the idle pass waits for the load
    // event, so nothing mounts before the patch lands.
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const fid = freshFid("lhs-defer");
    const fill = (o: string, text: string) =>
      `<li>${slotRange(o, fillHtml(fid, o, text, "b"))}</li>`;
    page = bootPage(
      frameHtml(fid, `<ul>${holeHtml(7, fill("item#0", "a") + fill("item#1", "b"))}</ul>`)
    );
    page.slotRecord(fid, "item#0", { text: "a" });
    page.slotRecord(fid, "item#1", { text: "b" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const seen: string[] = [];
    const cleaned: string[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            const text = untrack(() => p.text);
            seen.push(text);
            onCleanup(() => cleaned.push(text));
            return <b>{p.text}</b>;
          }}
        />
      ),
      page.container
    );
    disposers.push(dispose);
    await quiesce();
    // Deferred: nothing mounted yet.
    expect(seen).toEqual([]);
    const a = page.container.querySelector("b")!;
    // The server re-ran the hole: `item#0` changed, `item#1` is gone, a new
    // occurrence arrived (an empty range, as a hole's re-emission ships it).
    page.live.push({ type: "slot", fid, key: "item#0", args: { text: "A" } });
    page.live.push({ type: "slot", fid, key: "item#~7.1.0", args: { text: "c" } });
    page.live.push({
      type: "hole",
      key: "lh:7",
      html: fill("item#0", "a") + `<li>${slotRange("item#~7.1.0")}</li>`
    });
    await quiesce();
    await quiesce();
    // `item#0` hydrated the server's node with the args it was rendered
    // from, then took the new ones; `item#1` never mounted.
    expect(seen).toEqual(["a", "c"]);
    expect(page.container.querySelector("b")).toBe(a);
    expect([...page.container.querySelectorAll("b")].map(b => b.textContent)).toEqual(["A", "c"]);
    expect(cleaned).toEqual([]);
    expect(page.warnings.filter(w => w.includes("unclaimed") || w.includes("mismatch"))).toEqual(
      []
    );
  });
});
