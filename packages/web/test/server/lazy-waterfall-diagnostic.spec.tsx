/**
 * @jsxImportSource @solidjs/web
 */
// SSR_BOUNDARY_WATERFALL counts a boundary's render passes. A nested route
// meets its levels one pass at a time: a child level is only reached once its
// parent has rendered. The router starts every matched level's lazy() import
// (and every level's preload) in the first pass, so that work ran in
// parallel, but the pass count read it as a chain of sequential waits and
// pointed at data (#4105). The check now applies the client's origin rule: a
// wait counts only if something it waited on started at or after the
// previous wait landed. lazy() stamps its import when it starts, a cache
// stamps what it hands out (`OBSERVE.attribution.markFlight`), and an
// unstamped promise counts as starting when the boundary meets it.
//
// This suite imports source (the dev tier), so the dev checks are live.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Loading, renderToStream } from "@solidjs/web";
import { OBSERVE, createMemo, lazy } from "solid-js";
import type { JSX } from "@solidjs/web";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function stream(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, {
      // A dev server's manifest answers from its live module graph: async.
      manifest: async (id: string) => {
        await delay(2);
        return { js: [`/assets/${id.replace(/[^a-z]/gi, "")}.js`], css: [] };
      }
    }).pipe({
      write: (chunk: string) => void chunks.push(chunk),
      end: () => resolve(chunks.join(""))
    });
  });
}

/** `levels` nested lazy route levels, cold, each import landing a bit later. */
function routeLevels(levels: number, leaf: () => JSX.Element) {
  return Array.from({ length: levels }, (_, i) =>
    lazy(
      async () => {
        await delay(5 + i * 15);
        return {
          default: (props: { children?: JSX.Element }) => (
            <section>{i === levels - 1 ? leaf() : props.children}</section>
          )
        };
      },
      undefined,
      `./Level${i}.tsx`
    )
  );
}

/** The router's shape: every matched level's import kicked together, then nested. */
function Routes(props: {
  levels: ReturnType<typeof routeLevels>;
  preload: boolean;
  onPreload?: () => void;
}) {
  if (props.preload) {
    props.levels.forEach(level => level.preload());
    props.onPreload?.();
  }
  const nest = (i: number): JSX.Element => {
    const Level = props.levels[i];
    return <Level>{i + 1 < props.levels.length ? nest(i + 1) : null}</Level>;
  };
  return nest(0);
}

/** `depth` sequential reads, each gated on the previous answer. */
function Chain(props: { depth: number }): JSX.Element {
  const data = createMemo(async () => {
    await delay(3);
    return props.depth;
  });
  return <div>{data() && (props.depth > 1 ? <Chain depth={props.depth - 1} /> : "leaf")}</div>;
}

/**
 * A query cache: the fetch starts at preload, and every read gets a fresh
 * wrapper (`.then`) over it, as the router's query() does. `stamp` makes it
 * play ball (stamp the fetch, and each wrapper with the fetch's start).
 */
function queryCache(stamp: boolean) {
  let fetch: Promise<string> | undefined;
  const start = () => {
    fetch ||= delay(60).then(() => "page data");
    if (stamp) OBSERVE!.attribution.markFlight(fetch);
    return fetch;
  };
  const read = () => {
    const wrapper = start().then(v => v);
    if (stamp) OBSERVE!.attribution.markFlight(wrapper, OBSERVE!.attribution.flightOrigin(fetch!));
    return wrapper;
  };
  return { start, read };
}

describe("SSR_BOUNDARY_WATERFALL judges waits by when their work started", () => {
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
  const waterfalls = () => capture.events.filter(e => e.code === "SSR_BOUNDARY_WATERFALL");

  test("preloaded cold route chunks are not a waterfall", async () => {
    const levels = routeLevels(3, () => <b>leaf</b>);
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Routes levels={levels} preload />
      </Loading>
    ));
    expect(html).toMatch(/<b[^>]*>leaf<\/b>/);
    expect(waterfalls()).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test("route chunks nobody preloaded are one, each import starting a level late", async () => {
    const levels = routeLevels(3, () => <b>leaf</b>);
    await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Routes levels={levels} preload={false} />
      </Loading>
    ));
    const [event, ...rest] = waterfalls();
    expect(rest).toHaveLength(0);
    expect(event.severity).toBe("warn");
    expect(event.data).toMatchObject({ passes: 4 });
    expect(event.data).not.toHaveProperty("parallelWaits");
  });

  test("a data chain under preloaded route chunks still counts, and names the waits left out", async () => {
    const levels = routeLevels(2, () => <Chain depth={3} />);
    await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Routes levels={levels} preload />
      </Loading>
    ));
    const [event, ...rest] = waterfalls();
    expect(rest).toHaveLength(0);
    expect(event.severity).toBe("warn");
    // The first chunk, then the three reads; the second chunk started with
    // the first and is left out.
    expect(event.data).toMatchObject({ passes: 6, parallelWaits: 1 });
    expect(event.message).toContain(
      "6 render passes — 4 sequential async waits (not counting 1 on work already started"
    );
  });

  for (const stamp of [true, false])
    test(`page data a preload started, read under the page's chunk (${
      stamp ? "stamped: parallel" : "unstamped: counted"
    })`, async () => {
      const query = queryCache(stamp);
      function Page() {
        const data = createMemo(() => query.read());
        return <p>{data()}</p>;
      }
      const levels = routeLevels(2, () => <Page />);
      const html = await stream(() => (
        <Loading fallback={<i>loading</i>}>
          <Routes levels={levels} preload onPreload={query.start} />
        </Loading>
      ));
      expect(html).toContain("page data");
      // Chunks land at 5 and 20 ms; the data, started with them, at 60.
      if (stamp) expect(waterfalls()).toHaveLength(0);
      else {
        const [event] = waterfalls();
        expect(event.severity).toBe("info");
        expect(event.data).toMatchObject({ parallelWaits: 1 });
      }
    });
});
