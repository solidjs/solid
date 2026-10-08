/**
 * #3887: a derived store whose re-fetch rejects must reach the error
 * boundary, like a memo's does. The reader is the JSX shape — a render
 * effect under `Errored` > `Loading` — which `pullFamily` lets keep its frame
 * while the derive's flight is up; an errored derive has no landing for that
 * frame to wait for.
 */
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

async function settle() {
  for (let i = 0; i < 4; i++) {
    flush();
    await Promise.resolve();
    await new Promise(r => setTimeout(r));
  }
  flush();
}

function mount(read: () => unknown) {
  const shown: unknown[] = [];
  const dispose = createRoot(dispose => {
    const view = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            const text = createMemo(() => "content");
            createRenderEffect(read, () => {});
            return text;
          },
          () => "pending"
        ),
      () => "error"
    );
    createRenderEffect(
      () => {
        let v: any = view();
        while (typeof v === "function") v = v();
        return v;
      },
      v => void shown.push(v)
    );
    return dispose;
  });
  return { shown, dispose };
}

function failingReplacement<T>() {
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((_, fail) => (reject = fail));
  return { promise, fail: () => reject(new Error("replacement failed")) };
}

describe("a failed derived-store refetch reaches the error boundary (#3887)", () => {
  it("sync derive replaced by a rejecting async one", async () => {
    const replacement = failingReplacement<{ value: number }>();
    const [id, setId] = createSignal(0);
    const [store] = createStore(() => (id() ? replacement.promise : { value: 0 }), { value: 0 });
    const { shown, dispose } = mount(() => store.value);
    await settle();
    expect(shown.at(-1)).toBe("content");
    setId(1);
    await settle();
    replacement.fail();
    await settle();
    expect(shown.at(-1)).toBe("error");
    dispose();
  });

  it("async derive replaced by a rejecting async one", async () => {
    const replacement = failingReplacement<{ value: number }>();
    const [id, setId] = createSignal(0);
    const [store] = createStore(
      () => (id() ? replacement.promise : Promise.resolve({ value: 0 })),
      { value: -1 }
    );
    const { shown, dispose } = mount(() => store.value);
    await settle();
    expect(shown.at(-1)).toBe("content");
    setId(1);
    await settle();
    replacement.fail();
    await settle();
    expect(shown.at(-1)).toBe("error");
    dispose();
  });

  it("memo parity: a memo replaced by a rejecting async one", async () => {
    const replacement = failingReplacement<number>();
    const [id, setId] = createSignal(0);
    const value = createRoot(() => createMemo(() => (id() ? replacement.promise : 0)));
    const { shown, dispose } = mount(value);
    await settle();
    expect(shown.at(-1)).toBe("content");
    setId(1);
    await settle();
    replacement.fail();
    await settle();
    expect(shown.at(-1)).toBe("error");
    dispose();
  });
});
