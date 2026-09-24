/**
 * @jsxImportSource @solidjs/web
 */
// The `"boundary"` record on `OBSERVE.records` (sentry-integration-plan
// C3): one record per `<Loading>` boundary that WAITED during a server
// render — discovered with pending async, then settled — carrying the
// boundary's timing (discover → settle, settle → reveal), its pass count and
// how it ended. The client's `hold` records' server twin: the substrate an
// adapter opens boundary spans from and a waterfall verdict runs over.
//
// Pinned here, against the real renderers (`renderToStream`,
// `renderToString`) and the real `<Reveal>` coordination:
//
//  - a boundary that renders on its first pass emits nothing — no wait, no
//    record;
//  - `passes` counts render passes, so a sequential chain reads as `3`;
//  - `streamed` says whether the outcome reached the client after the shell
//    — the user saw the fallback — or inlined into it;
//  - `heldMs` is real: a grouped boundary's record waits for the group's
//    reveal and measures the time its finished content sat behind siblings;
//  - every outcome is a record: settled, the renderToString fallback, a
//    client-only handoff, and an error (the value as thrown beside it);
//  - the record locates by component (`ownerPath`), the same labels the
//    paired `SSR_RENDER_ERROR_CONTAINED` finding carries and the same `id`;
//  - a listener cannot break the render, and the emitter folds out of prod.
//
// This suite imports source (the dev tier) and compiles with `sourceNames`
// (vite.config.server.mjs), so `<App />` is a labelled component call.
//
// The numbers are cut from `performance.now()` reads in the runtime — at
// discovery, at settle, and (in a group) at reveal. Measured against real
// timers they were only bounded: a 30 ms timer armed BEFORE the boundary
// read its settle stamp measured a 23.6 ms hold against a 25 ms floor on a
// loaded CI runner (the error-propagation pass sat between the two, and a
// Node timer may fire a hair early against `performance.now()`). So the
// clock is the test's (the #3598 pattern): `performance.now()` stands still
// unless the test advances it, the sources whose timing is under test are
// hand-controlled deferreds, and every duration is asserted exactly. Real
// timers still let the promises settle and the shell drain; only the stamps
// are ours.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Loading, Reveal, renderToStream, renderToString } from "@solidjs/web";
import { OBSERVE, createMemo, type BoundaryEvent, type BoundaryLive } from "solid-js";
import type { JSX } from "@solidjs/web";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * One macrotask. A source's settlement reaches the boundary over microtasks
 * only — the memo's answer, the boundary's retry pass, its `record()` (the
 * settle stamp) and, in a group, the release it may trigger — so by the time
 * this resolves the runtime has read every stamp that settlement produces,
 * and the test may move the clock for the next one.
 */
const settle = () => new Promise<void>(r => setImmediate(r));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/**
 * Streams through a sink, the way a response does: the shell flushes when it
 * is ready and later fragments follow, so `streamed` means what it means in
 * production. Resolves with everything written, in order. `onShell` fires
 * on the first write — the shell has left, whatever settles now streams.
 */
function stream(code: () => any, onShell?: () => void): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        if (chunks.length === 0) onShell?.();
        chunks.push(chunk);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

type Record = { event: BoundaryEvent; live: BoundaryLive };

/** The test's clock: what `performance.now()` returns until the test moves it. */
const T0 = 1000;
let t = T0;

beforeEach(() => {
  t = T0;
  vi.spyOn(performance, "now").mockImplementation(() => t);
});

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
  vi.restoreAllMocks();
});

function records(): Record[] {
  const seen: Record[] = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("boundary", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

/** The `<template id="pl-…">` placeholder ids in document order. */
const placeholderIds = (html: string) =>
  [...html.matchAll(/<template id="pl-([^"]+)"/g)].map(m => m[1]);

/** An async read that answers `value` after `ms`. */
function Slow(props: { ms: number; value: string }): JSX.Element {
  const data = createMemo(async () => {
    await delay(props.ms);
    return props.value;
  });
  return <div>{data()}</div>;
}

describe("what is a record", () => {
  test("a boundary that renders on its first pass emits nothing", async () => {
    const seen = records();
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <div>ready</div>
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(html).toContain("ready");
    expect(seen).toHaveLength(0);
  });

  test("a boundary that waited: timing, passes, outcome, location — delivered once, at settle", async () => {
    const seen = records();
    const content = deferred<string>();
    function Content() {
      const data = createMemo(async () => content.promise);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Content />
        </Loading>
      );
    }
    const shell = deferred<void>();
    const done = stream(() => <App />, shell.resolve);
    // The shell has shipped with the fallback in it; the content answers
    // 20 ms (on the test's clock) after the boundary discovered the wait.
    await shell.promise;
    expect(seen).toHaveLength(0);
    t = T0 + 20;
    content.resolve("content");
    const html = await done;
    expect(html).toContain("content");

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    // The id is the placeholder's — the same id `SSR_RENDER_ERROR_CONTAINED`
    // names in `data.boundary`, so a record and a finding pair by it.
    expect(placeholderIds(html)).toEqual([event.id]);
    // `at` is the discovery stamp: the render's first pass, on the render's
    // clock. Discovery → settle spans the wait, exactly.
    expect(event.at).toBe(T0);
    expect(event.durationMs).toBe(20);
    // One round of async: the discovery pass and the pass that rendered.
    expect(event.passes).toBe(2);
    expect(event.outcome).toBe("settled");
    // Settled past the shell: the user saw the fallback, then the swap.
    expect(event.streamed).toBe(true);
    // Outside any <Reveal> the swap is issued as the boundary settles.
    expect(event.heldMs).toBe(0);
    expect(event.revealGroup).toBeUndefined();
    // The compiled `<Loading>` is a labelled component call, so the boundary
    // is the innermost label — the same walk the diagnostics make.
    expect(event.ownerPath).toEqual(["<App>", "<Loading>"]);
    expect(live).toEqual({});
  });

  test("a sequential chain counts its passes", async () => {
    const seen = records();
    function Chain() {
      const first = createMemo(async () => {
        await delay(5);
        return "first";
      });
      // The second read exists only once the first answered: a pass to
      // discover the first, a pass that discovers the second, a pass that
      // renders — the shape a waterfall verdict looks for.
      return <div>{first() ? <Slow ms={5} value="second" /> : null}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Chain />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(html).toContain("second");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.passes).toBe(3);
    expect(seen[0].event.outcome).toBe("settled");
  });

  test("a boundary that settled in time to inline into the shell is not `streamed`", async () => {
    const seen = records();
    function Held() {
      // `deferStream` holds the shell for this read, so the boundary settles
      // before anything is flushed and its content ships in the shell.
      const data = createMemo(
        async () => {
          await delay(10);
          return "in-shell";
        },
        { deferStream: true }
      );
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Held />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(html).toContain("in-shell");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("settled");
    expect(seen[0].event.streamed).toBe(false);
    expect(seen[0].event.passes).toBe(2);
  });
});

describe("the other outcomes", () => {
  test("renderToString: the fallback ships final and the client renders the content", () => {
    const seen = records();
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Slow ms={5} value="never-on-server" />
        </Loading>
      );
    }
    const html = renderToString(() => <App />);
    expect(html).toContain("loading");
    expect(seen).toHaveLength(1);
    const { event } = seen[0];
    expect(event.outcome).toBe("fallback");
    expect(event.streamed).toBe(false);
    expect(event.passes).toBe(1);
    expect(event.heldMs).toBe(0);
    expect(event.ownerPath).toEqual(["<App>", "<Loading>"]);
  });

  test("client-only content found at discovery: the client renders it, nothing streams", async () => {
    const seen = records();
    function ClientOnly() {
      const data = (createMemo as any)(() => "client", { ssrSource: "client" });
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <ClientOnly />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(html).toContain("loading");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("client");
    expect(seen[0].event.streamed).toBe(false);
    expect(seen[0].event.passes).toBe(1);
  });

  test("client-only content behind a real wait: the fragment hands off after the shell", async () => {
    const seen = records();
    function LateClientOnly() {
      const gate = createMemo(async () => {
        await delay(10);
        return true;
      });
      const data = (createMemo as any)(() => "client", { ssrSource: "client" });
      // The client hole is masked by the real async read on the first pass
      // and surfaces only on the retry, once the fragment is registered.
      return <div>{gate() && data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <LateClientOnly />
        </Loading>
      );
    }
    await stream(() => <App />);
    expect(seen).toHaveLength(1);
    expect(seen[0].event.outcome).toBe("client");
    expect(seen[0].event.streamed).toBe(true);
    expect(seen[0].event.passes).toBe(2);
  });

  test("an error: the value as thrown rides beside the record, and pairs with the finding by id", async () => {
    const seen = records();
    const capture = OBSERVE!.diagnostics.capture();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Bad() {
        const data = createMemo(async () => {
          await delay(10);
          throw new Error("late-boom");
        });
        return <div>{data()}</div>;
      }
      function App() {
        return (
          <Loading fallback={<i>loading</i>}>
            <Bad />
          </Loading>
        );
      }
      await stream(() => <App />);
      expect(seen).toHaveLength(1);
      const { event, live } = seen[0];
      expect(event.outcome).toBe("error");
      expect(event.streamed).toBe(true);
      expect((live.error as Error).message).toBe("late-boom");
      const findings = capture.events.filter(e => e.code === "SSR_RENDER_ERROR_CONTAINED");
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].data!.boundary).toBe(event.id);
      // The record is the boundary's; the finding locates the throw (the
      // component under it) and names the boundary's own path in `data`.
      expect(findings[0].data!.boundaryPath).toEqual(event.ownerPath);
      expect(findings[0].ownerPath).toEqual([...event.ownerPath!, "<Bad>"]);
    } finally {
      capture.stop();
      error.mockRestore();
    }
  });
});

describe("<Reveal> groups: heldMs", () => {
  /** Two sibling boundaries in one group, each over a test-owned source. */
  function Pair(props: { order?: "together" | "natural"; a: Promise<string>; b: Promise<string> }) {
    function SlotA() {
      const data = createMemo(async () => props.a);
      return <div>{data()}</div>;
    }
    function SlotB() {
      const data = createMemo(async () => props.b);
      return <div>{data()}</div>;
    }
    return (
      <Reveal order={props.order}>
        <Loading fallback={<i>a</i>}>
          <SlotA />
        </Loading>
        <Loading fallback={<i>b</i>}>
          <SlotB />
        </Loading>
      </Reveal>
    );
  }

  test("order=together: the early boundary's record waits for the reveal and measures the hold", async () => {
    const seen = records();
    const a = deferred<string>();
    const b = deferred<string>();
    function App() {
      return <Pair order="together" a={a.promise} b={b.promise} />;
    }
    const shell = deferred<void>();
    const done = stream(() => <App />, shell.resolve);
    // The shell has left with both fallbacks. A settles 5 ms in: the group
    // holds its swap for B — and holds its record: nothing is delivered yet.
    await shell.promise;
    t = T0 + 5;
    a.resolve("A");
    await settle();
    expect(seen).toHaveLength(0);
    // B settles 40 ms later; the group releases both, and A's record
    // arrives carrying the time its finished content sat behind B.
    t = T0 + 45;
    b.resolve("B");
    const html = await done;
    expect(html).toContain("A");
    expect(html).toContain("B");

    expect(seen).toHaveLength(2);
    const ids = placeholderIds(html);
    const aRec = seen.find(r => r.event.id === ids[0])!;
    const bRec = seen.find(r => r.event.id === ids[1])!;
    // Both name the group.
    expect(aRec.event.revealGroup).toBeDefined();
    expect(bRec.event.revealGroup).toBe(aRec.event.revealGroup);
    // A finished early and sat behind B: the hold is the gap, settle →
    // reveal; its own duration is still discover → settle, unchanged by
    // the hold.
    expect(aRec.event.at).toBe(T0);
    expect(aRec.event.durationMs).toBe(5);
    expect(aRec.event.heldMs).toBe(40);
    // B was the one everyone waited for: it revealed as it settled.
    expect(bRec.event.at).toBe(T0);
    expect(bRec.event.durationMs).toBe(45);
    expect(bRec.event.heldMs).toBe(0);
    expect(aRec.event.outcome).toBe("settled");
    expect(bRec.event.outcome).toBe("settled");
  });

  test("order=natural: each boundary reveals as it settles — no hold", async () => {
    const seen = records();
    const a = deferred<string>();
    const b = deferred<string>();
    function App() {
      return <Pair order="natural" a={a.promise} b={b.promise} />;
    }
    const shell = deferred<void>();
    const done = stream(() => <App />, shell.resolve);
    // The shell has left with both fallbacks. A settles first and reveals
    // at once: its record is delivered now, before B has answered, with
    // nothing held.
    await shell.promise;
    t = T0 + 5;
    a.resolve("A");
    await settle();
    expect(seen).toHaveLength(1);
    t = T0 + 25;
    b.resolve("B");
    const html = await done;

    expect(seen).toHaveLength(2);
    const ids = placeholderIds(html);
    const aRec = seen.find(r => r.event.id === ids[0])!;
    const bRec = seen.find(r => r.event.id === ids[1])!;
    expect(aRec.event.revealGroup).toBeDefined();
    expect(bRec.event.revealGroup).toBe(aRec.event.revealGroup);
    expect(aRec.event.durationMs).toBe(5);
    expect(bRec.event.durationMs).toBe(25);
    for (const { event } of seen) expect(event.heldMs).toBe(0);
  });

  test("a grouped boundary that errors still records, after the group releases it", async () => {
    const seen = records();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const a = deferred<string>();
      const b = deferred<string>();
      function App() {
        return <Pair order="together" a={a.promise} b={b.promise} />;
      }
      const shell = deferred<void>();
      const done = stream(() => <App />, shell.resolve);
      // The shell has left with both fallbacks. A fails 5 ms in: the group
      // holds the failed fragment's swap for B — and holds its record with it.
      await shell.promise;
      t = T0 + 5;
      a.reject(new Error("A failed"));
      await settle();
      expect(seen).toHaveLength(0);
      // B settles 30 ms after A failed: the group releases both.
      t = T0 + 35;
      b.resolve("B");
      await done;

      expect(seen).toHaveLength(2);
      const failed = seen.find(r => r.event.outcome === "error")!;
      expect((failed.live.error as Error).message).toBe("A failed");
      expect(failed.event.durationMs).toBe(5);
      expect(failed.event.heldMs).toBe(30);
      const settled = seen.find(r => r.event.outcome === "settled")!;
      expect(settled.event.durationMs).toBe(35);
      expect(settled.event.heldMs).toBe(0);
    } finally {
      error.mockRestore();
    }
  });
});

// The dev CHECKS the runtime derives from the same facts (server-dev-build-plan
// P4): coded verdicts on `OBSERVE.diagnostics`, so the console and
// `expectNoDiagnostics` see what an agent would otherwise have to read off
// the record. Dev tier (this suite imports source); they need no listener.
describe("dev checks off the record", () => {
  let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    capture = OBSERVE!.diagnostics.capture();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    capture.stop();
    warn.mockRestore();
  });
  const byCode = (code: string) => capture.events.filter(e => e.code === code);

  /** `depth` sequential reads, each gated on the previous answer. */
  function Chain(props: { depth: number }): JSX.Element {
    const data = createMemo(async () => {
      await delay(3);
      return props.depth;
    });
    return <div>{data() && (props.depth > 1 ? <Chain depth={props.depth - 1} /> : "leaf")}</div>;
  }

  test("ASYNC_WATERFALL: two sequential flights are advisory (structured only)", async () => {
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Chain depth={2} />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(html).toContain("leaf");
    const [event, ...rest] = byCode("ASYNC_WATERFALL");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("perf");
    expect(event.severity).toBe("info");
    expect(event.data).toMatchObject({ side: "server", passes: 3 });
    expect(typeof event.data!.sequentialMs).toBe("number");
    // Located by component and keyed by the boundary, like the record.
    expect(event.ownerPath).toEqual(["<App>", "<Loading>"]);
    expect(event.data!.boundary).toBe(placeholderIds(html)[0]);
    expect(event.message).toContain("2 sequential async flights");
    expect(warn).not.toHaveBeenCalled();
  });

  test("ASYNC_WATERFALL: three sequential flights earn the console, once", async () => {
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Chain depth={3} />
        </Loading>
      );
    }
    await stream(() => <App />);
    const [event, ...rest] = byCode("ASYNC_WATERFALL");
    expect(rest).toHaveLength(0);
    expect(event.severity).toBe("warn");
    expect(event.data).toMatchObject({ side: "server", passes: 4 });
    expect(event.message).toContain("3 sequential async flights");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[ASYNC_WATERFALL]");
    expect(String(warn.mock.calls[0][0])).toContain("in <App> › <Loading>");
  });

  test("a single wait is not a waterfall", async () => {
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Slow ms={5} value="content" />
        </Loading>
      );
    }
    await stream(() => <App />);
    expect(byCode("ASYNC_WATERFALL")).toHaveLength(0);
    expect(byCode("SSR_CLIENT_CONTENT_MASKED")).toHaveLength(0);
  });

  test("SSR_CLIENT_CONTENT_MASKED: client-only content that surfaced behind a server wait", async () => {
    function LateClientOnly() {
      const gate = createMemo(async () => {
        await delay(5);
        return true;
      });
      const data = (createMemo as any)(() => "client", { ssrSource: "client" });
      return <div>{gate() && data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <LateClientOnly />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    const [event, ...rest] = byCode("SSR_CLIENT_CONTENT_MASKED");
    expect(rest).toHaveLength(0);
    expect(event.kind).toBe("ssr");
    expect(event.severity).toBe("warn");
    expect(event.data).toMatchObject({ boundary: placeholderIds(html)[0], passes: 2 });
    expect(event.ownerPath).toEqual(["<App>", "<Loading>"]);
    expect(event.message).toContain("after 1 server wait");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[SSR_CLIENT_CONTENT_MASKED]");
  });

  test("client-only content found at discovery ships with the shell: no finding", async () => {
    function ClientOnly() {
      const data = (createMemo as any)(() => "client", { ssrSource: "client" });
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <ClientOnly />
        </Loading>
      );
    }
    await stream(() => <App />);
    expect(byCode("SSR_CLIENT_CONTENT_MASKED")).toHaveLength(0);
  });
});

describe("the channel", () => {
  test("a throwing listener is reported; the render and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.records.subscribe("boundary", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.records.subscribe("boundary", event => {
          seen.push(event.outcome);
        })
      );
      function App() {
        return (
          <Loading fallback={<i>loading</i>}>
            <Slow ms={5} value="content" />
          </Loading>
        );
      }
      const html = await stream(() => <App />);
      expect(html).toContain("content");
      expect(seen).toEqual(["settled"]);
      expect(error).toHaveBeenCalledTimes(1);
      expect((error.mock.calls[0][0] as Error).message).toBe("listener bug");
    } finally {
      error.mockRestore();
    }
  });

  test("unsubscribed listeners hear nothing", async () => {
    const seen = records();
    for (const off of unsubscribes.splice(0)) off();
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Slow ms={5} value="content" />
        </Loading>
      );
    }
    await stream(() => <App />);
    expect(seen).toHaveLength(0);
  });
});

describe("tiers, in the built artifacts", () => {
  test("the emitter (and the slots) fold out of prod; observe and dev carry them", () => {
    const read = (name: string) =>
      readFileSync(resolve(import.meta.dirname, "../../../solid/dist", name), "utf8");
    // The emitter's pre-check, gated on the tier: prod has no boundary that
    // asks whether it is observed.
    const marker = '.observed("boundary")';
    expect(read("server.js")).not.toContain(marker);
    expect(read("server.observe.js")).toContain(marker);
    expect(read("server.dev.js")).toContain(marker);
  });

  test("the Reveal group's onReveal plumbing folds out of prod with it", () => {
    const read = (name: string) =>
      readFileSync(resolve(import.meta.dirname, "../../../solid/dist", name), "utf8");
    // The hook is registered under this option name and read back from the
    // group's map; prod has no boundary that registers one, so the tier
    // gate takes both out of the artifact.
    expect(read("server.js")).not.toContain("onReveal");
    expect(read("server.observe.js")).toContain("onReveal");
    expect(read("server.dev.js")).toContain("onReveal");
  });
});
