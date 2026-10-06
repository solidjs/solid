import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  isPending
} from "../../src/index.js";

const delay = () => new Promise<void>(resolve => setTimeout(resolve, 20));

// No source change: cover the manual write before any re-derivation occurs.
describe("optimistic shadows over a writable derived store", () => {
  it.each([undefined, true])("covers a held flag reset from %s", async initial => {
    let dispose!: () => void;
    let release!: () => void;
    let move!: () => Promise<void>;
    let startDrag!: () => void;
    let drag!: () => boolean;
    const shown: string[] = [];
    createRoot(d => {
      dispose = d;
      const [source] = createSignal<{ failed?: boolean }>(
        initial === undefined ? {} : { failed: initial }
      );
      const [local, setLocal] = createStore(() => ({ ...source() }), {});
      const [view, setView] = createOptimisticStore(local);
      const [dragging, setDragging] = createSignal(false);
      drag = dragging;
      startDrag = () => setDragging(true);
      const preview = createMemo(() => {
        if (!dragging()) return () => "hidden";
        return createMemo(() => (view.failed ? "failed" : "ready"));
      });
      createRenderEffect(
        () => preview()(),
        value => void shown.push(value)
      );
      move = action(function* () {
        setLocal(draft => {
          draft.failed = false;
        });
        setView(draft => {
          draft.failed = false;
        });
        yield new Promise<void>(resolve => {
          release = resolve;
        });
      });
    });
    await delay();
    const done = move();
    try {
      await delay();
      startDrag();
      await delay();
      expect(shown).toEqual(["hidden", "ready"]);
      expect(isPending(drag)).toBe(false);
    } finally {
      release();
      await done;
      await delay();
      dispose();
    }
  });

  it("covers a held reset on a nested row without replacing that row", async () => {
    let dispose!: () => void;
    let release!: () => void;
    let move!: () => Promise<void>;
    let startDrag!: () => void;
    let drag!: () => boolean;
    const shown: string[] = [];
    createRoot(d => {
      dispose = d;
      const [source] = createSignal<{ id: number; failed?: boolean }[]>([{ id: 1 }]);
      const [local, setLocal] = createStore(() => source().map(row => ({ ...row })), []);
      const [view, setView] = createOptimisticStore(local);
      const row = view[0];
      const [dragging, setDragging] = createSignal(false);
      drag = dragging;
      startDrag = () => setDragging(true);
      const preview = createMemo(() => {
        if (!dragging()) return () => "hidden";
        return createMemo(() => (row.failed ? "failed" : "ready"));
      });
      createRenderEffect(
        () => preview()(),
        value => void shown.push(value)
      );
      move = action(function* () {
        setLocal(draft => {
          draft[0].failed = false;
        });
        setView(draft => {
          draft[0].failed = false;
        });
        yield new Promise<void>(resolve => {
          release = resolve;
        });
      });
    });
    await delay();
    const done = move();
    try {
      await delay();
      startDrag();
      await delay();
      expect(shown).toEqual(["hidden", "ready"]);
      expect(isPending(drag)).toBe(false);
    } finally {
      release();
      await done;
      await delay();
      dispose();
    }
  });

  it("composes with guesses on an inner optimistic store and reverts on settle", async () => {
    let dispose!: () => void;
    let release!: () => void;
    let edit!: () => Promise<void>;
    const shown: number[] = [];
    createRoot(d => {
      dispose = d;
      const [base] = createStore({ count: 0 });
      const [inner, setInner] = createOptimisticStore(base);
      const [outer, setOuter] = createOptimisticStore(inner);
      createRenderEffect(
        () => outer.count,
        value => void shown.push(value)
      );
      edit = action(function* () {
        setInner(draft => {
          draft.count = 1;
        });
        setOuter(draft => {
          draft.count++;
        });
        yield new Promise<void>(resolve => {
          release = resolve;
        });
      });
    });
    await delay();
    const done = edit();
    try {
      await delay();
      expect(shown).toEqual([0, 2]);
    } finally {
      release();
      await done;
      await delay();
      dispose();
    }
    expect(shown.at(-1)).toBe(0);
  });
});
