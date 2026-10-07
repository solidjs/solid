/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * S-ref — the pending read is the decode table's (frames residue step 4).
 *
 * "A `{$ref}` to a key the response has not delivered yet is answered by
 * that response's table with a promise the table owns; the key's `data`
 * chunk settles it; the response's end rejects every read the response
 * never answered (L1 — a value that never comes is an error where it is
 * read, not a silence)."
 *
 * Mechanism: serialization/src/serializer-decode.ts `createJSONDataTable`
 * — `resolve` of a missing key mints one pending read per key (a promise
 * marked `s = 0`), `apply` of the key settles it (stamped `s = 1` / `v`),
 * `close(error)` rejects what is still pending (`s = 2`); frames/src
 * `createFrameHost.settleArgs` counts a record's pending reads
 * (`record.pending`) and re-applies the record when the last settles; the
 * host tells the integration a response ended (`closeData`), and the
 * shared host (frames/src/client.ts) closes that response's table. C5 / C6
 * pin which response's data answers a read; this file pins the read's own
 * lifecycle — at the table (a) and through the production shared host (b,
 * c), where no earlier pin reached the rejection.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, Errored, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { getFrameHost, installServerComponents } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { createDataSource, freshFid, pump, stubHeldFetch } from "./support.js";

const WIRE = "srv";
const ARTICLE = `<article><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`;
const start = { type: "start", id: WIRE, version: 1 };
const slot = (ref: string) => ({
  type: "slot",
  id: WIRE,
  version: 1,
  key: "comment#0",
  args: { text: { $ref: ref } }
});
const html = { type: "html", id: WIRE, version: 1, html: ARTICLE };
const complete = { type: "complete", id: WIRE, version: 1 };

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
  await host.prepareData({ type: "data", id: "", version: 0, node: null } as any);
  return host;
}

/**
 * A site under a `<Loading>` and an `<Errored>`: the fill records every
 * value its prop read yields; a read that throws reaches the `<em>`.
 */
function mountSite(call: Promise<unknown>) {
  const Site = dynamic(() => call as any);
  const seen: string[] = [];
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Errored fallback={err => <em>{String((err() as any)?.message)}</em>}>
        <Loading fallback={<span>…</span>}>
          <Site
            comment={(p: any) => {
              createMemo(() => seen.push(p.text));
              return <li>{p.text}</li>;
            }}
          />
        </Loading>
      </Errored>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  disposers.push(dispose);
  return {
    div,
    seen,
    li: () => div.querySelector("li")?.textContent,
    error: () => div.querySelector("em")?.textContent
  };
}

describe("S-ref — the pending read is the table's", () => {
  // Arm (a): the table alone. A missing key answers with ONE pending read
  // (a second reader gets the same promise), marked `s = 0` so a consumer
  // tells it from a delivered value that is itself a promise; the key's
  // `apply` settles it, stamped `s = 1` / `v` (a synchronous reader adopts
  // the value), and runs the read's `c` callbacks IN that apply — even
  // when the delivered value is a pending promise the read adopts (the
  // consumer learns of the delivery, not of the inner value); `close()`
  // rejects what is still pending with an error naming the key,
  // `close(error)` with the response's own; a second close is a no-op; a
  // key delivered after a close is a value again.
  test("(a) the table: resolve of a missing key is a marked pending read; apply settles it stamped and runs its callbacks; close rejects the rest", async () => {
    const table = createJSONDataTable();
    const source = createDataSource();
    const read = table.resolve<any>({ $ref: "1" });
    expect(read).toBeInstanceOf(Promise);
    expect(read.s).toBe(0);
    expect(read.c).toEqual([]);
    expect(table.resolve({ $ref: "1" })).toBe(read);
    const other = table.resolve<any>({ $ref: "2" });
    expect(other).not.toBe(read);
    const settled: string[] = [];
    read.c.push(() => settled.push("1"));
    other.c.push(() => settled.push("2"));
    for (const c of source.chunks(WIRE, 1, { "1": "one" })) table.apply(c);
    expect(read.s).toBe(1);
    expect(read.v).toBe("one");
    expect(settled).toEqual(["1"]);
    await expect(read).resolves.toBe("one");
    expect(table.resolve({ $ref: "1" })).toBe("one");
    expect(other.s).toBe(0);
    table.close();
    expect(other.s).toBe(2);
    expect(other.v).toBeInstanceOf(Error);
    expect(other.v.message).toContain('{$ref: "2"}');
    expect(settled).toEqual(["1", "2"]);
    await expect(other).rejects.toBe(other.v);
    // A key whose value is a PENDING promise: the read is settled — stamped
    // `s = 1`, `v` the promise, callbacks run — at delivery, while the read
    // itself (adopting the value) stays pending until the value does.
    let resolveInner!: (v: string) => void;
    const inner = new Promise<string>(r => (resolveInner = r));
    const asyncRead = table.resolve<any>({ $ref: "p" });
    let delivered = 0;
    asyncRead.c.push(() => delivered++);
    const patches: any[] = [];
    for (const c of createDataSource().chunks(WIRE, 1, { p: inner }, c => patches.push(c)))
      table.apply(c);
    expect(delivered).toBe(1);
    expect(asyncRead.s).toBe(1);
    expect(asyncRead.v).toBeInstanceOf(Promise);
    let outer: string | undefined;
    asyncRead.then((v: string) => (outer = v));
    await Promise.resolve();
    expect(outer).toBeUndefined();
    resolveInner("late");
    await new Promise(r => setTimeout(r));
    for (const c of patches.splice(0)) table.apply(c);
    await expect(asyncRead).resolves.toBe("late");
    // Idempotent; a read minted after the close is a fresh pending one.
    table.close();
    const late = table.resolve<any>({ $ref: "3" });
    expect(late.s).toBe(0);
    const reason = new Error("the response's own");
    table.close(reason);
    expect(late.s).toBe(2);
    expect(late.v).toBe(reason);
    await expect(late).rejects.toBe(reason);
  });

  // Arm (b): L1 through the production shared host. The record names a key
  // the response never delivers; the html mounts the occurrence, which
  // WAITS (a fresh mount pends on `record.pending`, not into its covering
  // boundary — the frame's shell shows with the range as the server left
  // it); the stream completes. The response's table closes, the read
  // rejects, the mount runs and its read throws: the nearest client
  // `<Errored>` shows the error, which names the key. Nothing fabricated
  // ever reached the fill.
  test("(b) a {$ref} the response never delivers rejects at complete: the fill's read throws to <Errored>, naming the key", async () => {
    const fid = freshFid("sref-b");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE]);
    const [v1] = held;
    const p1 = getX(1);
    await p1;
    v1.send(start);
    v1.send(slot("1"));
    v1.send(html);
    await pump(1);
    const site = mountSite(p1);
    await pump();
    // The shell landed; the occurrence waits on its read — no fallback, no
    // value, no error.
    expect(site.div.querySelector("article")).not.toBeNull();
    expect(site.div.querySelector("span")).toBeNull();
    expect(site.seen).toEqual([]);
    expect(site.li()).toBeUndefined();
    expect(site.error()).toBeUndefined();
    v1.send(complete);
    v1.close();
    await pump();
    expect(site.seen).toEqual([]);
    expect(site.li()).toBeUndefined();
    expect(site.error()).toContain('{$ref: "1"}');
  });

  // Arm (c) (control): the same shape with the data arriving between the
  // record and the end — the read settles through the table's own apply,
  // the mount runs with the value, and the close at `complete` has nothing
  // left to reject.
  test("(c) control: the key delivered before complete settles the read; the mount runs with the value and nothing rejects", async () => {
    const fid = freshFid("sref-c");
    const getX = createServerReference(fid);
    await sharedHost();
    const { held } = stubHeldFetch([WIRE]);
    const [v1] = held;
    const p1 = getX(1);
    await p1;
    v1.send(start);
    v1.send(slot("1"));
    v1.send(html);
    await pump(1);
    const site = mountSite(p1);
    await pump();
    expect(site.seen).toEqual([]);
    for (const c of createDataSource().chunks(WIRE, 1, { "1": "one" })) v1.send(c);
    await pump();
    expect(site.seen).toEqual(["one"]);
    expect(site.li()).toBe("one");
    v1.send(complete);
    v1.close();
    await pump();
    expect(site.seen).toEqual(["one"]);
    expect(site.li()).toBe("one");
    expect(site.error()).toBeUndefined();
  });
});
