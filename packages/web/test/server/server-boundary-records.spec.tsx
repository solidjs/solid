/**
 * @jsxImportSource @solidjs/web
 */
// The `"boundary"` record on `OBSERVE.server.records` (sentry-integration-plan
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
// This suite imports source (the dev tier) and compiles with `componentNames`
// (vite.config.server.mjs), so `<App />` is a labelled component call.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Loading, Reveal, renderToStream, renderToString } from "@solidjs/web";
import { OBSERVE, createMemo, type BoundaryEvent, type BoundaryLive } from "solid-js";
import type { JSX } from "@solidjs/web";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/**
 * Streams through a sink, the way a response does: the shell flushes when it
 * is ready and later fragments follow, so `streamed` means what it means in
 * production. Resolves with everything written, in order.
 */
function stream(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

type Record = { event: BoundaryEvent; live: BoundaryLive };

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
});

function records(): Record[] {
  const seen: Record[] = [];
  unsubscribes.push(
    OBSERVE!.server.records.subscribe("boundary", (event, live) => {
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
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Slow ms={20} value="content" />
        </Loading>
      );
    }
    const before = performance.now();
    const html = await stream(() => <App />);
    const after = performance.now();
    expect(html).toContain("content");

    expect(seen).toHaveLength(1);
    const { event, live } = seen[0];
    // The id is the placeholder's — the same id `SSR_RENDER_ERROR_CONTAINED`
    // names in `data.boundary`, so a record and a finding pair by it.
    expect(placeholderIds(html)).toEqual([event.id]);
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.at).toBeLessThanOrEqual(after);
    // Discovery → settle spans the wait; the record's clock is the render's.
    expect(event.durationMs).toBeGreaterThanOrEqual(15);
    expect(event.durationMs).toBeLessThanOrEqual(after - before);
    // One round of async: the discovery pass and the pass that rendered.
    expect(event.passes).toBe(2);
    expect(event.outcome).toBe("settled");
    // 20ms is past the shell: the user saw the fallback, then the swap.
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
      expect(findings[0].ownerPath).toEqual(event.ownerPath);
    } finally {
      capture.stop();
      error.mockRestore();
    }
  });
});

describe("<Reveal> groups: heldMs", () => {
  test("order=together: the early boundary's record waits for the reveal and measures the hold", async () => {
    const seen = records();
    const b = deferred<string>();
    function SlotB() {
      const data = createMemo(async () => b.promise);
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Reveal order="together">
          <Loading fallback={<i>a</i>}>
            <Slow ms={5} value="A" />
          </Loading>
          <Loading fallback={<i>b</i>}>
            <SlotB />
          </Loading>
        </Reveal>
      );
    }
    const done = stream(() => <App />);
    // A has settled; the group holds its swap for B — and holds its record.
    await delay(40);
    expect(seen).toHaveLength(0);
    b.resolve("B");
    const html = await done;
    expect(html).toContain("A");
    expect(html).toContain("B");

    expect(seen).toHaveLength(2);
    const ids = placeholderIds(html);
    const a = seen.find(r => r.event.id === ids[0])!;
    const bRec = seen.find(r => r.event.id === ids[1])!;
    // Both name the group.
    expect(a.event.revealGroup).toBeDefined();
    expect(bRec.event.revealGroup).toBe(a.event.revealGroup);
    // A finished early and sat behind B: the hold is the gap, not zero; its
    // own duration is still discover → settle, unchanged by the hold.
    expect(a.event.durationMs).toBeLessThan(35);
    expect(a.event.heldMs).toBeGreaterThanOrEqual(30);
    // B was the one everyone waited for: it revealed as it settled.
    expect(bRec.event.durationMs).toBeGreaterThanOrEqual(35);
    expect(bRec.event.heldMs).toBeLessThan(10);
    expect(a.event.outcome).toBe("settled");
    expect(bRec.event.outcome).toBe("settled");
  });

  test("order=natural: each boundary reveals as it settles — no hold", async () => {
    const seen = records();
    function App() {
      return (
        <Reveal>
          <Loading fallback={<i>a</i>}>
            <Slow ms={5} value="A" />
          </Loading>
          <Loading fallback={<i>b</i>}>
            <Slow ms={25} value="B" />
          </Loading>
        </Reveal>
      );
    }
    await stream(() => <App />);
    expect(seen).toHaveLength(2);
    for (const { event } of seen) {
      expect(event.revealGroup).toBeDefined();
      expect(event.heldMs).toBeLessThan(10);
    }
  });

  test("a grouped boundary that errors still records, after the group releases it", async () => {
    const seen = records();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Bad() {
        const data = createMemo(async () => {
          await delay(5);
          throw new Error("A failed");
        });
        return <div>{data()}</div>;
      }
      function App() {
        return (
          <Reveal order="together">
            <Loading fallback={<i>a</i>}>
              <Bad />
            </Loading>
            <Loading fallback={<i>b</i>}>
              <Slow ms={20} value="B" />
            </Loading>
          </Reveal>
        );
      }
      await stream(() => <App />);
      expect(seen).toHaveLength(2);
      const failed = seen.find(r => r.event.outcome === "error")!;
      expect((failed.live.error as Error).message).toBe("A failed");
      expect(failed.event.heldMs).toBeGreaterThanOrEqual(10);
      expect(seen.find(r => r.event.outcome === "settled")).toBeDefined();
    } finally {
      error.mockRestore();
    }
  });
});

describe("the channel", () => {
  test("a throwing listener is reported; the render and the other listeners are unaffected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seen: string[] = [];
      unsubscribes.push(
        OBSERVE!.server.records.subscribe("boundary", () => {
          throw new Error("listener bug");
        })
      );
      unsubscribes.push(
        OBSERVE!.server.records.subscribe("boundary", event => {
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
    // The one string that survives minification: the registered name the
    // slots are created and read under.
    const marker = "solid-js/observe/server/listeners";
    expect(read("server.js")).not.toContain(marker);
    expect(read("server.observe.js")).toContain(marker);
    expect(read("server.dev.js")).toContain(marker);
  });
});
