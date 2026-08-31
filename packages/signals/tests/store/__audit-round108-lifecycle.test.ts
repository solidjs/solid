import { afterEach, describe, expect, it } from "vitest";
import "../../src/boundaries.js";
import {
  createOwner,
  createRoot,
  createSignal,
  createStore,
  flush,
  registerPatch,
  resetErrorHalt,
  runWithOwner
} from "../../src/index.js";
import { EFFECT_RENDER } from "../../src/core/constants.js";
import { patchCountForTests } from "../../src/store/next/patch.js";

class HeldQueue {
  _disabled = { _value: true };
  _collapsed = { _value: true };
  _parent = null;
  queues: Array<Array<(type: number) => void>> = [[], []];
  constructor(private handled = false) {}
  enqueue(type: number, fn: (type: number) => void) {
    this.queues[type - 1].push(fn);
  }
  run(type: number) {
    const pending = this.queues[type - 1];
    this.queues[type - 1] = [];
    for (let i = 0; i < pending.length; i++) pending[i](type);
  }
  addChild() {}
  removeChild() {}
  notify() {
    return this.handled;
  }
  stashQueues() {}
  restoreQueues() {}
}

afterEach(() => resetErrorHalt());

function heldConsumer() {
  const queue = new HeldQueue();
  const owner = createOwner() as any;
  owner._queue = queue;
  const [dep, setDep] = createRoot(() => createSignal("d1"));
  const [state, setState] = createStore<any>({ row: { value: "v1" } });
  const log: string[] = [];
  let unbind!: () => void;
  runWithOwner(owner, () => {
    unbind = registerPatch(
      state.row,
      (n: any, _p: any, force?: boolean) => {
        if (force) log.push(n.extra);
        else void n.extra;
      },
      ["extra"]
    ) as () => void;
  });
  const demote = () =>
    setState((s: any) => {
      Object.defineProperty(s.row, "extra", {
        get() {
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
  return { demote, dep, log, owner, queue, setDep, unbind };
}

describe("held demotion lifecycle", () => {
  it("explicit unbind before redrive prevents effect creation", () => {
    const c = heldConsumer();
    c.demote();
    c.unbind();
    flush();
    expect(c.queue.queues[0]).toHaveLength(0);
    c.setDep("d2");
    flush();
    expect(c.queue.queues[0]).toHaveLength(0);
    expect(c.log).toEqual([]);
    c.owner.dispose();
  });

  it("explicit unbind after creation cancels the queued first run and tracking", () => {
    const c = heldConsumer();
    c.demote();
    flush();
    expect(c.queue.queues[0]).toHaveLength(1);
    c.unbind();
    c.queue.run(EFFECT_RENDER);
    expect(c.log).toEqual([]);
    c.setDep("d2");
    flush();
    expect(c.queue.queues[0]).toHaveLength(0);
    c.owner.dispose();
  });

  it("explicit unbind after first run removes the live subscription", () => {
    const c = heldConsumer();
    c.demote();
    flush();
    c.queue.run(EFFECT_RENDER);
    expect(c.log).toEqual(["d1"]);
    c.unbind();
    c.setDep("d2");
    flush();
    c.queue.run(EFFECT_RENDER);
    expect(c.log).toEqual(["d1"]);
    c.owner.dispose();
  });

  it("owner disposal cancels the queued root and restores accounting", () => {
    const base = patchCountForTests();
    const c = heldConsumer();
    expect(patchCountForTests()).toBe(base + 1);
    c.demote();
    flush();
    expect(patchCountForTests()).toBe(base);
    expect(c.owner._firstChild).not.toBeNull();
    c.owner.dispose();
    c.queue.run(EFFECT_RENDER);
    c.setDep("d2");
    flush();
    expect(c.log).toEqual([]);
    expect(patchCountForTests()).toBe(base);
  });
});

describe("compute capture and tracking", () => {
  it("unhandled held compute error creates every sibling before deferred halt", () => {
    const queue = new HeldQueue(false);
    const owner = createOwner() as any;
    owner._queue = queue;
    const [state, setState] = createStore<any>({ row: { label: "v1", score: 0 } });
    const log: string[] = [];
    runWithOwner(owner, () => {
      registerPatch(
        state.row,
        (n: any, _p: any, force?: boolean) => {
          if (force) log.push("thrower-commit");
          else void n.score;
        },
        ["score"]
      );
      registerPatch(
        state.row,
        (n: any, _p: any, force?: boolean) => {
          if (force) log.push("healthy:" + n.label);
        },
        ["label"]
      );
    });
    setState((s: any) => {
      Object.defineProperty(s.row, "score", {
        get() {
          throw new Error("compute boom");
        },
        configurable: true,
        enumerable: true
      });
    });
    expect(() => flush()).toThrow("compute boom");
    expect(queue.queues[0]).toHaveLength(2);
    resetErrorHalt();
    queue.run(EFFECT_RENDER);
    // Round 10.9: a FAILED compute skips its commit (the swallow-then-
    // -apply this originally pinned was the audit finding); the healthy
    // sibling — whose OWN envelope never touches the throwing key —
    // installs and applies.
    expect(log).toEqual(["healthy:v1"]);
    owner.dispose();
  });

  it("handled held compute error leaves every sibling runnable", () => {
    const queue = new HeldQueue(true);
    const owner = createOwner() as any;
    owner._queue = queue;
    const [state, setState] = createStore<any>({ row: { label: "v1", score: 0 } });
    const log: string[] = [];
    runWithOwner(owner, () => {
      registerPatch(state.row, (n: any, _p: any, force?: boolean) => {
        if (force) log.push("thrower-commit");
        else void n.score;
      });
      registerPatch(state.row, (n: any, _p: any, force?: boolean) => {
        if (force) log.push("healthy:" + n.label);
      });
    });
    setState((s: any) => {
      Object.defineProperty(s.row, "score", {
        get() {
          throw new Error("handled boom");
        },
        configurable: true,
        enumerable: true
      });
    });
    expect(() => flush()).not.toThrow();
    expect(queue.queues[0]).toHaveLength(2);
    queue.run(EFFECT_RENDER);
    // Round 10.9: handled or not, a failed compute never commits.
    expect(log).toEqual(["healthy:v1"]);
    owner.dispose();
  });

  it("a nonthrowing compute tracks the introduced getter", () => {
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ row: { value: "v1" } });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.row, (n: any, _p: any, force?: boolean) => {
        if (force) log.push(n.extra);
        else void n.extra;
      });
    });
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
    expect(log).toEqual(["d1"]);
    setDep("d2");
    flush();
    expect(log).toEqual(["d1", "d2"]);
    dispose();
  });

  it("reads before a throw remain tracked and successful recovery adds later dependencies", () => {
    const [throws, setThrows] = createRoot(() => createSignal(true));
    const [dep, setDep] = createRoot(() => createSignal("d1"));
    const [state, setState] = createStore<any>({ row: { value: "v1" } });
    const log: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      registerPatch(state.row, (n: any, _p: any, force?: boolean) => {
        if (force) log.push("commit");
        else void n.extra;
      });
    });
    setState((s: any) => {
      Object.defineProperty(s.row, "extra", {
        get() {
          if (throws()) throw new Error("recoverable");
          return dep();
        },
        configurable: true,
        enumerable: true
      });
    });
    expect(() => flush()).toThrow("recoverable");
    // Round 10.9: the failed compute's commit is skipped…
    expect(log).toEqual([]);
    resetErrorHalt();
    setThrows(false);
    flush();
    // …and recovery (the pre-throw read stayed tracked) commits cleanly,
    // with the successful run's later reads adding their dependencies.
    expect(log).toEqual(["commit"]);
    setDep("d2");
    flush();
    expect(log).toEqual(["commit", "commit"]);
    dispose();
  });
});
