/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import {
  createMemo,
  createRevealOrder,
  createRoot,
  createSignal,
  createStore,
  Errored,
  flush,
  For,
  Loading,
  reconcile,
  resetErrorHalt
} from "solid-js";
import { patchDriver, render, rowProof } from "@solidjs/web";

afterEach(() => resetErrorHalt());

function mountHeld(handled: boolean) {
  const [state, setState] = createStore<any>({ row: { label: "v1", score: 0 } });
  let release!: (value: string) => void;
  const healthy: string[] = [];
  const div = document.createElement("div");
  const Frontier = () => {
    const data = createMemo(() => new Promise<string>(resolve => (release = resolve)));
    return <span>{data()}</span>;
  };
  const Thrower = () => {
    patchDriver(
      state.row,
      (n: any, _p: any, force?: boolean) => {
        if (!force) void n.score;
      },
      ["score"]
    );
    return <span>thrower</span>;
  };
  const Healthy = () => {
    patchDriver(
      state.row,
      (n: any, _p: any, force?: boolean) => {
        if (force) healthy.push(n.label);
      },
      ["label"]
    );
    return <span>healthy</span>;
  };
  const Tail = () => (
    <>
      {handled ? (
        <Errored fallback={<span>caught</span>}>
          <Thrower />
        </Errored>
      ) : (
        <Thrower />
      )}
      <Healthy />
    </>
  );
  const dispose = render(
    () =>
      createRevealOrder(
        () => (
          <>
            <Loading fallback="frontier">
              <Frontier />
            </Loading>
            <Loading fallback="tail">
              <Tail />
            </Loading>
          </>
        ),
        { collapsed: () => true }
      ),
    div
  );
  flush();
  healthy.length = 0;
  const demote = () =>
    setState((s: any) => {
      Object.defineProperty(s.row, "score", {
        get() {
          throw new Error("compute boom");
        },
        configurable: true,
        enumerable: true
      });
    });
  return { demote, dispose, div, healthy, release };
}

test("handled compute throw preserves healthy fanout through a real collapsed hold", async () => {
  const c = mountHeld(true);
  c.demote();
  expect(() => flush()).not.toThrow();
  expect(c.healthy).toEqual([]);
  c.release("ready");
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(c.healthy).toEqual(["v1"]);
  expect(c.div.textContent).toContain("caught");
  c.dispose();
});

test("unhandled compute throw installs held healthy fanout before the deferred halt", async () => {
  const c = mountHeld(false);
  c.demote();
  expect(() => flush()).toThrow("compute boom");
  expect(c.healthy).toEqual([]);
  // Test-only recovery from the intentional application halt proves that
  // the healthy effect was installed before the deferred error surfaced.
  resetErrorHalt();
  c.release("ready");
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(c.healthy).toEqual(["v1"]);
  c.dispose();
});

test("removing a demoted For row severs its fallback effect", () => {
  const [dep, setDep] = createRoot(() => createSignal("d1"));
  const [state, setState] = createStore<any>({
    rows: [{ id: 1, extra: "plain" }]
  });
  const log: string[] = [];
  const Row = rowProof((row: any) => {
    const text = document.createTextNode("");
    patchDriver(
      row,
      (n: any, _p: any, force?: boolean) => {
        if (force) {
          text.data = n.extra;
          log.push(n.extra);
        } else void n.extra;
      },
      ["extra"]
    );
    return text as any;
  });
  const div = document.createElement("div");
  const dispose = render(() => <For each={state.rows}>{Row}</For>, div);
  flush();
  setState((s: any) => {
    Object.defineProperty(s.rows[0], "extra", {
      get() {
        return dep();
      },
      configurable: true,
      enumerable: true
    });
  });
  flush();
  expect(log[log.length - 1]).toBe("d1");
  setState((s: any) => reconcile([], "id")(s.rows));
  flush();
  const removedAt = log.length;
  expect(div.textContent).toBe("");
  setDep("d2");
  flush();
  expect(log).toHaveLength(removedAt);
  dispose();
});

test("render-root disposal severs a live demoted fallback", () => {
  const [dep, setDep] = createRoot(() => createSignal("d1"));
  const [state, setState] = createStore<any>({ row: { extra: "plain" } });
  const log: string[] = [];
  const div = document.createElement("div");
  const dispose = render(() => {
    patchDriver(state.row, (n: any, _p: any, force?: boolean) => {
      if (force) log.push(n.extra);
      else void n.extra;
    });
    return <span />;
  }, div);
  setState((s: any) => {
    Object.defineProperty(s.row, "extra", {
      get() {
        return dep();
      },
      configurable: true,
      enumerable: true
    });
  });
  flush();
  expect(log[log.length - 1]).toBe("d1");
  dispose();
  const disposedAt = log.length;
  setDep("d2");
  flush();
  expect(log).toHaveLength(disposedAt);
});
