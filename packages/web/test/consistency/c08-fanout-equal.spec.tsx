/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C8 — fan-out equality.
 *
 * "All mounts of one address show the same server content and the same
 * resolved slot args at quiescence, whichever registered first, whatever
 * each mount's own version history, and however the registrations
 * interleave with the chunks."
 *
 * Mechanism meant to carry it: frames/src/frame-client.ts `createFrameHost`
 * (`frames: Map<id, Set<Frame>>`, `register`'s one-apply seed from the
 * resident store + `rebase`, `apply`'s fan-out to every frame of the id),
 * plus — for a later version reaching mounted sites — frame-transport.ts
 * `stage`/`commit` (a refetch of a shown address is staged, #3759, and its
 * commit applies through the same host fan-out).
 *
 * Two sites of ONE `dynamic()` (one factory memo → one call → one stream;
 * the second site mounts over the kept binding without a request), the
 * second registering before / between / after the first response's chunks;
 * then a same-args refetch (a later version) reaches both.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { createDataSource, freshFid, makeHost, pump, stubHeldFetch } from "./support.js";

const WIRE = "srv";
const chunks = (version: number, title: string, text: string) => ({
  start: { type: "start", id: WIRE, version },
  slot: { type: "slot", id: WIRE, version, key: "comment#0", args: { text, n: version } },
  html: {
    type: "html",
    id: WIRE,
    version,
    html: `<article><h1>${title}</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`
  },
  complete: { type: "complete", id: WIRE, version }
});

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

/** A frame's shown markup with the slot/claim markers stripped. */
const shown = (root: ParentNode, section: string) =>
  root.querySelector(`#${section} solid-frame`)!.innerHTML.replace(/<!--[^]*?-->/g, "");

/**
 * Two sites of one `dynamic()`; site `b` mounts when `showB` flips. Each
 * fill records every `text/n` pair its prop reads yield.
 */
function mountSites(getX: (...args: any[]) => unknown) {
  const [tick, setTick] = createSignal(0);
  const [showB, setShowB] = createSignal(false);
  const Story = dynamic(() => (tick(), getX(1) as any));
  const seen = { a: [] as string[], b: [] as string[] };
  const fill = (which: "a" | "b") => (p: any) => {
    createMemo(() => seen[which].push(`${p.text}/${p.n}`));
    return <li>{p.text}</li>;
  };
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <section id="a">
        <Loading fallback={<span>…</span>}>
          <Story comment={fill("a")} />
        </Loading>
      </section>
      <section id="b">
        {showB() ? (
          <Loading fallback={<span>…</span>}>
            <Story comment={fill("b")} />
          </Loading>
        ) : null}
      </section>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  return { div, seen, setTick, setShowB };
}

function expectEqualMounts(div: HTMLDivElement, seen: { a: string[]; b: string[] }) {
  expect(shown(div, "a")).toBe(shown(div, "b"));
  expect(seen.a[seen.a.length - 1]).toBe(seen.b[seen.b.length - 1]);
}

describe("C8 — fan-out equality", () => {
  // The second site registers at each point of the first response's chunk
  // sequence: before any chunk, between slot and html, between html and
  // complete, after the body ended. Then a later version reaches both.
  const points = ["before", "after-slot", "after-html", "after-complete"] as const;
  for (const point of points) {
    test(`(${point}) the second mount registers ${point.replace("-", " ")}: both show the same content and args; a later version reaches both`, async () => {
      const fid = freshFid(`c8-${point}`);
      const getX = createServerReference(fid);
      installServerComponents(makeHost().host);
      const { held, calls } = stubHeldFetch([WIRE, WIRE]);
      const [v1, v2] = held;
      const site = mountSites(getX);
      if (point === "before") site.setShowB(true);
      await pump();
      const c1 = chunks(1, "Story 1", "one");
      v1.send(c1.start);
      v1.send(c1.slot);
      await pump(1);
      if (point === "after-slot") {
        site.setShowB(true);
        await pump();
      }
      v1.send(c1.html);
      await pump(1);
      if (point === "after-html") {
        site.setShowB(true);
        await pump();
      }
      v1.send(c1.complete);
      v1.close();
      await pump();
      if (point === "after-complete") {
        site.setShowB(true);
        await pump();
      }
      // One call, one stream — the second site mounted over the kept binding.
      expect(calls.length).toBe(1);
      expect(site.div.querySelector("#a h1")!.textContent).toBe("Story 1");
      expect(site.div.querySelector("#b h1")!.textContent).toBe("Story 1");
      expect(site.seen.a).toEqual(["one/1"]);
      expect(site.seen.b).toEqual(["one/1"]);
      expectEqualMounts(site.div, site.seen);

      // A later version (same-args refetch; staged behind the shown address
      // and committed whole) reaches both mounts.
      site.setTick(1);
      await pump();
      expect(calls.length).toBe(2);
      const c2 = chunks(2, "Story 2", "two");
      v2.send(c2.start);
      v2.send(c2.slot);
      v2.send(c2.html);
      v2.send(c2.complete);
      v2.close();
      await pump();
      expect(site.div.querySelector("#a h1")!.textContent).toBe("Story 2");
      expect(site.div.querySelector("#b h1")!.textContent).toBe("Story 2");
      expect(site.seen.a).toEqual(["one/1", "two/2"]);
      expect(site.seen.b).toEqual(["one/1", "two/2"]);
      expectEqualMounts(site.div, site.seen);
    });
  }

  // Resolved args through the host's resolver: the slot record carries a
  // `{$ref}` whose value rides a `data` chunk (one codec source for the
  // test's single table — see the harness note on ref scoping), the second
  // site registering between the data and the record. Both resolve the
  // same value from the same table, at v1 and at the later version.
  test("(refs) {$ref} slot args resolve equally in both mounts, at v1 and at a later version", async () => {
    const fid = freshFid("c8-refs");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const data = createDataSource();
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [v1, v2] = held;
    const site = mountSites(getX);
    await pump();
    v1.send({ type: "start", id: WIRE, version: 1 });
    for (const c of data.chunks(WIRE, 1, { t1: "one" })) v1.send(c);
    await pump(1);
    site.setShowB(true);
    await pump();
    v1.send({
      type: "slot",
      id: WIRE,
      version: 1,
      key: "comment#0",
      args: { text: { $ref: "t1" }, n: 1 }
    });
    v1.send(chunks(1, "Story 1", "").html);
    v1.send({ type: "complete", id: WIRE, version: 1 });
    v1.close();
    await pump();
    expect(site.seen.a).toEqual(["one/1"]);
    expect(site.seen.b).toEqual(["one/1"]);
    expectEqualMounts(site.div, site.seen);
    site.setTick(1);
    await pump();
    v2.send({ type: "start", id: WIRE, version: 2 });
    for (const c of data.chunks(WIRE, 2, { t2: "two" })) v2.send(c);
    v2.send({
      type: "slot",
      id: WIRE,
      version: 2,
      key: "comment#0",
      args: { text: { $ref: "t2" }, n: 2 }
    });
    v2.send(chunks(2, "Story 2", "").html);
    v2.send({ type: "complete", id: WIRE, version: 2 });
    v2.close();
    await pump();
    expect(site.div.querySelector("#a h1")!.textContent).toBe("Story 2");
    expect(site.seen.a).toEqual(["one/1", "two/2"]);
    expect(site.seen.b).toEqual(["one/1", "two/2"]);
    expectEqualMounts(site.div, site.seen);
  });

  // A mount whose own history differs: site b mounts only AFTER the later
  // version landed (it never saw v1) — its seed is the resident store at
  // v2 and it must equal site a, which morphed v1 → v2.
  test("(history) a mount registering after the second version never saw the first: equal at quiescence", async () => {
    const fid = freshFid("c8-history");
    const getX = createServerReference(fid);
    installServerComponents(makeHost().host);
    const { held } = stubHeldFetch([WIRE, WIRE]);
    const [v1, v2] = held;
    const site = mountSites(getX);
    await pump();
    const c1 = chunks(1, "Story 1", "one");
    for (const c of [c1.start, c1.slot, c1.html, c1.complete]) v1.send(c);
    v1.close();
    await pump();
    site.setTick(1);
    await pump();
    const c2 = chunks(2, "Story 2", "two");
    for (const c of [c2.start, c2.slot, c2.html, c2.complete]) v2.send(c);
    v2.close();
    await pump();
    expect(site.div.querySelector("#a h1")!.textContent).toBe("Story 2");
    site.setShowB(true);
    await pump();
    expect(site.div.querySelector("#b h1")!.textContent).toBe("Story 2");
    expect(site.seen.a).toEqual(["one/1", "two/2"]);
    expect(site.seen.b).toEqual(["two/2"]);
    expectEqualMounts(site.div, site.seen);
  });
});
