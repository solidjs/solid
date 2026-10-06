/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Generic hydration pins — the root module preload as a HOLD
 * (`documentation/server-components/frames-consistency-contract.md`
 * §"Generic hydration", GH5 / GH6). `hydrate()` with a root module map
 * (`<renderId>_assets`) defers its render behind `loadModuleAssets`
 * (web/src/client.ts `hydrate`, the `rootMapping` branch). That wait is a
 * hold on the page's hydration — the root has claimed nothing yet — and
 * it registers with nothing `checkHydrationComplete` counts: only
 * `sharedConfig.hydrating` (the root's own flag) and `_pendingBoundaries`
 * (`<Loading>` registrations). Plain Solid 2, hand-built `_$HY` fixtures
 * (as hydration/loading-lazy-resume-3749.spec.tsx builds its preload).
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootHy,
  hydrationInProgress,
  installBootstrapCapture,
  macrotask,
  onHydrationEnd,
  spyConsole
} from "./support.js";

function pendingPreload(hy: any, key: string) {
  let land!: () => void;
  hy.loading[key] = new Promise<void>(r => (land = r)).then(() => {
    hy.modules[key] = {};
  });
  return land;
}

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await macrotask();
  await macrotask();
  delete (globalThis as any)._$HY;
  document.body.innerHTML = "";
});

describe("GH5 — hydration-done does not count a root's module preload (C3)", () => {
  function twoRoots() {
    const hy = bootHy({ r: { a_assets: { a0: "/assets/A.js" } }, modules: {}, loading: {} });
    const land = pendingPreload(hy, "a0");
    const A = document.createElement("div");
    const B = document.createElement("div");
    document.body.append(A, B);
    A.innerHTML = `<div _hk=a0><button>a</button></div>`;
    B.innerHTML = `<div _hk=b0><button>b</button></div>`;
    const serverA = A.firstElementChild!;
    let aClicks = 0;
    let bClicks = 0;
    const startA = () =>
      disposers.push(
        hydrate(
          () => (
            <div>
              <button onClick={() => aClicks++}>a</button>
            </div>
          ),
          A,
          { renderId: "a" }
        )
      );
    const startB = () =>
      disposers.push(
        hydrate(
          () => (
            <div>
              <button onClick={() => bClicks++}>b</button>
            </div>
          ),
          B,
          { renderId: "b" }
        )
      );
    return { hy, land, A, B, serverA, startA, startB, clicks: () => ({ a: aClicks, b: bClicks }) };
  }

  // Observed: B's synchronous pass ends → `checkHydrationComplete` sees no
  // pending boundary → done drains (onHydrationEnd fires, isHydrationInProgress
  // false, `_$HY.done = true` a macrotask later) while A — a hydration root
  // this page started — has not claimed a node and cannot until its module
  // lands. Expected: done waits for (or counts) the preload.
  test.fails(
    "root A deferred behind its preload, root B hydrates synchronously: done fires before A has claimed",
    async () => {
      const t = twoRoots();
      const spies = spyConsole();
      const ends: string[] = [];
      t.startA();
      onHydrationEnd(() => ends.push("end"));
      expect(hydrationInProgress()).toBe(true);
      t.startB();
      flush();
      await macrotask();
      try {
        // A is still waiting; its server markup is unclaimed.
        expect(t.hy.completed.has(t.serverA)).toBe(false);
        expect(hydrationInProgress()).toBe(true);
        expect(ends).toEqual([]);
        expect(t.hy.done).not.toBe(true);
      } finally {
        t.land();
        await macrotask();
        await macrotask();
        spies.restore();
      }
    }
  );

  // The consequence a user sees: once done has drained an empty replay
  // queue, `_$HY.events` is nulled and the bootstrap stops capturing. A
  // click on A's server markup during A's preload wait is neither queued
  // nor handled — the page had declared itself hydrated.
  test.fails(
    "a click on the deferred root during its wait is lost once the wrong done drained the queue",
    async () => {
      const t = twoRoots();
      const spies = spyConsole();
      const uncapture = installBootstrapCapture(document.body);
      // one pre-hydration click on B, so the replay has a queue to drain
      t.B.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      t.startA();
      t.startB();
      flush();
      await macrotask();
      // the user clicks A while A still waits on its module
      t.A.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      t.land();
      await macrotask();
      await macrotask();
      flush();
      await macrotask();
      try {
        expect(t.clicks()).toEqual({ a: 1, b: 1 });
      } finally {
        uncapture();
        spies.restore();
      }
    }
  );

  test("control: a single deferred root — done waits for the preload, the queued click replays", async () => {
    const hy = bootHy({ r: { _assets: { "0": "/assets/A.js" } }, modules: {}, loading: {} });
    const land = pendingPreload(hy, "0");
    const A = document.createElement("div");
    document.body.append(A);
    A.innerHTML = `<div _hk=0><button>a</button></div>`;
    const uncapture = installBootstrapCapture(document.body);
    A.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let clicks = 0;
    const ends: string[] = [];
    disposers.push(
      hydrate(
        () => (
          <div>
            <button onClick={() => clicks++}>a</button>
          </div>
        ),
        A
      )
    );
    onHydrationEnd(() => ends.push("end"));
    flush();
    await macrotask();
    expect(hydrationInProgress()).toBe(true);
    expect(ends).toEqual([]);
    land();
    await macrotask();
    await macrotask();
    flush();
    await macrotask();
    expect(ends).toEqual(["end"]);
    expect(hydrationInProgress()).toBe(false);
    expect(clicks).toBe(1);
    uncapture();
  });
});

describe("GH6 — disposing a root during its module preload does not cancel the deferred render (C14)", () => {
  // Observed: `hydrate()` returns `() => disposer && disposer()` with
  // `disposer` unset until the preload lands; a dispose before that is a
  // no-op, the render still runs when the module lands, and the root stays
  // live (reacting to writes) with no handle left to dispose it. Expected:
  // nothing renders after dispose; `hydrating` and completion settle.
  test.fails("dispose before the module lands: the root must not render afterwards", async () => {
    const hy = bootHy({ r: { _assets: { "0": "/assets/A.js" } }, modules: {}, loading: {} });
    const land = pendingPreload(hy, "0");
    const A = document.createElement("div");
    document.body.append(A);
    A.innerHTML = `<div _hk=0>x</div>`;
    const [t, setT] = createSignal("x");
    let renders = 0;
    const dispose = hydrate(() => {
      renders++;
      return <div>{t()}</div>;
    }, A);
    dispose();
    land();
    await macrotask();
    await macrotask();
    flush();
    setT("y");
    flush();
    try {
      expect(renders).toBe(0);
      expect(A.innerHTML).toBe(`<div _hk="0">x</div>`);
    } finally {
      // the leaked root: a second call reaches the late disposer
      dispose();
    }
  });

  test("control: dispose after the module landed tears the root down", async () => {
    const hy = bootHy({ r: { _assets: { "0": "/assets/A.js" } }, modules: {}, loading: {} });
    const land = pendingPreload(hy, "0");
    const A = document.createElement("div");
    document.body.append(A);
    A.innerHTML = `<div _hk=0>x</div>`;
    const [t, setT] = createSignal("x");
    const dispose = hydrate(() => <div>{t()}</div>, A);
    land();
    await macrotask();
    await macrotask();
    flush();
    expect(A.querySelector("div")!.textContent).toBe("x");
    dispose();
    // a render root's disposer clears what it rendered; a later write lands nowhere
    expect(A.querySelector("div")).toBeNull();
    setT("y");
    flush();
    expect(A.querySelector("div")).toBeNull();
  });
});
