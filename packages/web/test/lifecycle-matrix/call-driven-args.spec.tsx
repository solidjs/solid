/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: FRESH CALL-DRIVEN MOUNT, crossed with the
// ARG TIER dimension: scalars ride the chunk, `{$ref}` args resolve against
// the response's streamed data table (async values settle through patch
// records), `{$frame}` args are nested server regions. See MATRIX.md.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost, frameResponse, dataChunks, createDataSource, pump, settle } from "./harness.js";

const getScalars = createServerReference("matrix/args/scalars");
const getRef = createServerReference("matrix/args/ref");
const getRefSame = createServerReference("matrix/args/ref-same");
const getRefChanged = createServerReference("matrix/args/ref-changed");
const getRegion = createServerReference("matrix/args/region");
const getPromise = createServerReference("matrix/args/promise");
const getIterable = createServerReference("matrix/args/iterable");

const slotArticle =
  "<article><h1>T</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>";

function mountUnderLoading(Comp: any, props: Record<string, any> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Comp {...props} />
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    dispose,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

/** A hand-driven async iterable: push yields, end closes. */
function channel<T>() {
  const buffered: IteratorResult<T>[] = [];
  const waiters: ((r: IteratorResult<T>) => void)[] = [];
  const put = (r: IteratorResult<T>) => {
    const w = waiters.shift();
    w ? w(r) : buffered.push(r);
  };
  return {
    push: (value: T) => put({ value, done: false }),
    end: () => put({ value: undefined as any, done: true }),
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            const r = buffered.shift();
            return r
              ? Promise.resolve(r)
              : new Promise<IteratorResult<T>>(res => waiters.push(res));
          }
        };
      }
    } as AsyncIterable<T>
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("call-driven/args/scalars", () => {
  test("scalar args ride the record and pass through as literals", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        {
          type: "slot",
          id: "srv",
          version: 1,
          key: "comment#0",
          args: { s: "str", n: 42, b: true, z: null }
        },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const seen: any[] = [];
    const Page = dynamic(() => getScalars() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        seen.push([p.s, p.n, p.b, p.z]);
        return (
          <li>
            {p.s}:{String(p.n)}:{String(p.b)}:{String(p.z)}
          </li>
        );
      }
    });
    await pump();

    expect(seen).toEqual([["str", 42, true, null]]);
    expect(m.div.querySelector("ul li")!.textContent).toBe("str:42:true:null");

    m.cleanup();
  });
});

describe("call-driven/args/data-refs", () => {
  test("a {$ref} arg resolves to the streamed data table's value (rich objects survive the codec)", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const payload = { label: "hello", nested: { list: [1, 2, 3] }, when: new Date(0) };
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...dataChunks("srv", 1, { d1: payload }),
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { data: { $ref: "d1" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const seen: any[] = [];
    const Page = dynamic(() => getRef() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        seen.push(p.data);
        return (
          <li>
            {p.data.label}:{p.data.nested.list.join(",")}:{String(p.data.when.getTime())}
          </li>
        );
      }
    });
    await pump();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(payload); // structural roundtrip, incl. the Date
    expect(m.div.querySelector("ul li")!.textContent).toBe("hello:1,2,3:0");

    m.cleanup();
  });

  test("a re-sent record whose {$ref} decodes to the SAME value is adopted silently: no re-call, no props churn", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    // One codec stream per test table (see harness note on ref scoping).
    const data = createDataSource();
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...data.chunks("srv", 1, { d1: { label: "x" } }),
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { data: { $ref: "d1" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    let mounts = 0;
    const reads: string[] = [];
    let bump!: () => void;
    const Page = dynamic(() => getRefSame() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        const [n, setN] = createSignal(0);
        bump = () => setN(n() + 1);
        createMemo(() => reads.push(p.data.label));
        return (
          <li>
            {p.data.label}:{n()}
          </li>
        );
      }
    });
    await pump();
    bump();
    flush();
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("x:1");
    expect(reads).toEqual(["x"]);

    // Tables rotate per response, so the next stream's ref has a NEW key —
    // but it decodes to an equal value. Value-compare, don't re-call.
    const addr = "matrix/args/ref-same";
    for (const c of data.chunks(addr, 2, { d2: { label: "x" } })) host.apply(c);
    host.apply({
      type: "slot",
      id: addr,
      version: 2,
      key: "comment#0",
      args: { data: { $ref: "d2" } }
    });
    await pump(1);

    expect(mounts).toBe(1);
    expect(m.div.querySelector("ul li")).toBe(li);
    expect(li.textContent).toBe("x:1"); // client state intact
    expect(reads).toEqual(["x"]); // live props never pushed — no churn

    m.cleanup();
  });

  test("a re-sent record whose {$ref} decodes to a DIFFERENT value updates the live occurrence (no re-call)", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const data = createDataSource();
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...data.chunks("srv", 1, { d1: { label: "x" } }),
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { data: { $ref: "d1" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    let mounts = 0;
    const reads: string[] = [];
    let bump!: () => void;
    const Page = dynamic(() => getRefChanged() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        const [n, setN] = createSignal(0);
        bump = () => setN(n() + 1);
        createMemo(() => reads.push(p.data.label));
        return (
          <li>
            {p.data.label}:{n()}
          </li>
        );
      }
    });
    await pump();
    bump();
    flush();
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("x:1");

    const addr = "matrix/args/ref-changed";
    for (const c of data.chunks(addr, 2, { d2: { label: "y" } })) host.apply(c);
    host.apply({
      type: "slot",
      id: addr,
      version: 2,
      key: "comment#0",
      args: { data: { $ref: "d2" } }
    });
    await pump(1);

    expect(mounts).toBe(1); // live-props path, not a re-call
    expect(m.div.querySelector("ul li")).toBe(li); // node identity survives
    expect(li.textContent).toBe("y:1"); // new value, old client state
    expect(reads).toEqual(["x", "y"]); // the reactive read fired

    m.cleanup();
  });
});

describe("call-driven/args/regions", () => {
  test("{$frame} region: content streams into the live wrapper, survives root morphs, and REBINDS when a response renames the wire id", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const addr = "matrix/args/region";
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        {
          type: "slot",
          id: "srv",
          version: 1,
          key: "comment#0",
          args: { cid: "c1", children: { $frame: "srv.comment#0.children" } }
        },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        // The region's own content rides the same response, producer-relative id.
        { type: "html", id: "srv.comment#0.children", version: 1, html: "<em>body-1</em>" },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    let mounts = 0;
    const Page = dynamic(() => getRegion() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        return <div class="wrap">{p.children}</div>;
      }
    });
    await pump();

    const region = m.div.querySelector(".wrap solid-frame")! as HTMLElement;
    const em = m.div.querySelector("em")!;
    expect(em.textContent).toBe("body-1");
    (em as HTMLElement).dataset.keep = "yes";

    // A ROOT morph re-sends the shell around the slot range: the occurrence's
    // range — and the region element inside it — is protected, not rebuilt.
    host.apply({
      type: "html",
      id: addr,
      version: 2,
      html: slotArticle.replace("<h1>T</h1>", "<h1>T2</h1>")
    });
    await pump(1);
    expect(m.div.querySelector("h1")!.textContent).toBe("T2");
    expect(m.div.querySelector(".wrap solid-frame")).toBe(region);
    expect(m.div.querySelector("em")).toBe(em);
    expect((em as HTMLElement).dataset.keep).toBe("yes");

    // A later response addresses the SAME region by a new wire name (the
    // single-flight shape: regions render under the call's address). The
    // record re-send carries the renamed {$frame}; the live region rebinds
    // and the new stream's chunks reach the same element.
    host.apply({
      type: "slot",
      id: addr,
      version: 3,
      key: "comment#0",
      args: { cid: "c1", children: { $frame: `${addr}.comment#0.children` } }
    });
    host.apply({
      type: "html",
      id: `${addr}.comment#0.children`,
      version: 1,
      html: "<em>body-2</em>"
    });
    await pump(1);

    expect(mounts).toBe(1); // rename is a rebind, never a re-call
    expect(m.div.querySelector(".wrap solid-frame")).toBe(region); // same element
    expect(m.div.querySelector("em")!.textContent).toBe("body-2"); // morphed in place

    m.cleanup();
  });
});

describe("call-driven/args/async-values", () => {
  test("a PROMISE {$ref} arg: the fill's read suspends on its own <Loading>, then settles when the patch record streams in", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let resolveBody!: (v: string) => void;
    const body = new Promise<string>(r => (resolveBody = r));
    const late: any[] = [];
    const initial = dataChunks("srv", 1, { body }, c => late.push(c));
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...initial,
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { body: { $ref: "body" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const Page = dynamic(() => getPromise() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        const text = createMemo(() => p.body);
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <b>{text()}</b>
          </Loading>
        );
      }
    });
    await pump();

    // The occurrence mounted; its async read holds its own boundary.
    expect(m.div.textContent).toContain("fill-wait");
    expect(m.div.querySelector("b")).toBe(null);

    // The producer's promise settles: seroval emits a patch record, which
    // rides the (still open) stream as another data chunk.
    resolveBody("resolved-body");
    await settle();
    for (const c of late.splice(0)) host.apply(c);
    await pump();

    expect(m.div.textContent).not.toContain("fill-wait");
    expect(m.div.querySelector("b")!.textContent).toBe("resolved-body");

    m.cleanup();
  });

  test("an ASYNC-ITERABLE {$ref} arg: the fill's read updates once per yield", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const ch = channel<string>();
    const late: any[] = [];
    const initial = dataChunks("srv", 1, { feed: ch.iterable }, c => late.push(c));
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        ...initial,
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { feed: { $ref: "feed" } } },
        { type: "html", id: "srv", version: 1, html: slotArticle },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const flushData = async () => {
      await settle();
      for (const c of late.splice(0)) host.apply(c);
      await pump();
    };

    const Page = dynamic(() => getIterable() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        const v = createMemo(() => p.feed);
        return (
          <Loading fallback={<i>fill-wait</i>}>
            <b>{v()}</b>
          </Loading>
        );
      }
    });
    await pump();
    // No yield yet: the read is pending.
    expect(m.div.textContent).toContain("fill-wait");

    ch.push("one");
    await flushData();
    expect(m.div.querySelector("b")!.textContent).toBe("one");

    ch.push("two");
    await flushData();
    expect(m.div.querySelector("b")!.textContent).toBe("two");

    // Between yields the LAST value holds (no fallback re-flash).
    expect(m.div.textContent).not.toContain("fill-wait");

    ch.end();
    await flushData();
    expect(m.div.querySelector("b")!.textContent).toBe("two");

    m.cleanup();
  });
});
