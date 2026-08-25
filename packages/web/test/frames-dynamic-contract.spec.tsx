/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Pins the `dynamic` async-source semantics the server-component transport
 * depends on (see frames/src/frame-transport.ts):
 *  1. an async source is invoked once per dependency change — resolution
 *     does NOT replay it (a replay would double-fetch server functions);
 *  2. a refetch resolving to the SAME component reference is swallowed by
 *     the equals-gate — the mounted instance is not re-created;
 *  3. while a refetch is pending, the previously resolved component stays
 *     mounted (no fallback re-flash for an already-resolved boundary).
 */
import { describe, expect, test } from "vitest";
import {
  createRoot,
  createSignal,
  flush,
  type Component,
  type Element as SolidElement
} from "solid-js";
import { dynamic } from "../src/index.js";
import { Loading } from "solid-js";

describe("dynamic async-source contract for server components", () => {
  test("source runs once per dep change; same-ref resolution keeps the instance; pending keeps stale content", async () => {
    let sourceRuns = 0;
    let mounts = 0;
    let bump!: () => void;
    const Stable: Component<{ children?: SolidElement }> = () => {
      mounts++;
      const [n, setN] = createSignal(0);
      bump = () => setN(n() + 1);
      return <button>count:{n()}</button>;
    };

    const [dep, setDep] = createSignal(1);
    const resolvers: ((c: typeof Stable) => void)[] = [];
    const calls: Promise<typeof Stable>[] = [];

    let div!: HTMLDivElement;
    let disposer!: () => void;
    createRoot(dispose => {
      disposer = dispose;
      const User = dynamic(() => {
        dep();
        sourceRuns++;
        const p = new Promise<typeof Stable>(r => resolvers.push(r));
        calls.push(p);
        return p;
      });
      <div ref={div}>
        <Loading fallback={<span>loading...</span>}>
          <User />
        </Loading>
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<span>loading...</span>");
    expect(sourceRuns).toBe(1);

    resolvers[0](Stable);
    await calls[0];
    flush();

    expect(div.innerHTML).toBe("<button>count:0</button>");
    // 1. resolution did not replay the source
    expect(sourceRuns).toBe(1);
    expect(mounts).toBe(1);

    // client state inside the mounted instance
    bump();
    flush();
    expect(div.innerHTML).toBe("<button>count:1</button>");

    // refetch: dep change re-runs the source exactly once
    setDep(2);
    flush();
    expect(sourceRuns).toBe(2);

    // 3. pending refetch keeps the stale component mounted, no fallback
    expect(div.innerHTML).toBe("<button>count:1</button>");

    // 2. same-ref resolution is swallowed: no remount, state intact
    resolvers[1](Stable);
    await calls[1];
    flush();
    expect(div.innerHTML).toBe("<button>count:1</button>");
    expect(mounts).toBe(1);

    disposer();
  });
});
