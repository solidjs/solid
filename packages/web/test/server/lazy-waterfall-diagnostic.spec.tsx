/**
 * @jsxImportSource @solidjs/web
 */
// SSR_BOUNDARY_WATERFALL counts a boundary's render passes. On a cold module
// cache, nested lazy() route levels resolve one level per pass even when the
// router started every import in the first pass (it calls each matched
// level's `component.preload()` together), so the pass count said
// "sequential waits" for loads that ran in parallel, and the advice pointed
// at data. Passes that waited only on lazy() code are left out of the count
// (#4105); data waits are still counted, with the code waits named beside
// them.
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
        await delay(5 + i * 2);
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
function Routes(props: { levels: ReturnType<typeof routeLevels>; preload: boolean }) {
  if (props.preload) props.levels.forEach(level => level.preload());
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

describe("SSR_BOUNDARY_WATERFALL and lazy() code", () => {
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

  for (const preload of [true, false])
    test(`cold nested route chunks are not a data waterfall (preloaded: ${preload})`, async () => {
      const levels = routeLevels(3, () => <b>leaf</b>);
      const html = await stream(() => (
        <Loading fallback={<i>loading</i>}>
          <Routes levels={levels} preload={preload} />
        </Loading>
      ));
      expect(html).toMatch(/<b[^>]*>leaf<\/b>/);
      expect(waterfalls()).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    });

  test("a data chain under cold route chunks still counts, and names the code waits", async () => {
    const levels = routeLevels(2, () => <Chain depth={3} />);
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Routes levels={levels} preload />
      </Loading>
    ));
    expect(html).toContain("leaf");
    const [event, ...rest] = waterfalls();
    expect(rest).toHaveLength(0);
    expect(event.severity).toBe("warn");
    expect(event.data).toMatchObject({ codePasses: expect.any(Number) });
    const { passes, codePasses } = event.data as { passes: number; codePasses: number };
    expect(codePasses).toBeGreaterThan(0);
    expect(passes - 1 - codePasses).toBe(3);
    expect(event.message).toContain(
      `${passes} render passes — 3 sequential async waits (not counting ${codePasses} on lazy() code)`
    );
  });
});
