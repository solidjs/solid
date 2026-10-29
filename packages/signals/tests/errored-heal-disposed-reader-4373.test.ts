import { expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

// #4373 (ruled): an error boundary heals when the reader that threw is
// disposed and no other live reader holds the error — a reader that is no
// longer the display holds nothing (F-3), and the error fallback is a
// fallback (F-12). The shape: `<Errored><Show when={isPending(m)}><span>
// {m()}</span></Show></Errored>`, an action whose write makes `m` throw.
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

function mount(extraReader: boolean) {
  let release!: () => void;
  const [s, setS] = createSignal(3);
  const act = action(function* (v: number) {
    setS(v);
    yield new Promise<void>(r => (release = r));
  });
  const screen: { branch?: unknown; extra?: unknown; view?: unknown } = {};
  const dispose = createRoot(dispose => {
    const m = createMemo(() => {
      if (s() === 1) throw new Error("boom");
      return s();
    });
    const view = createErrorBoundary(
      () => {
        // `<Show when={isPending(m)}>`: the branch owns the reader of `m()`.
        const open = createMemo(() => isPending(m));
        const branch = createMemo(() => {
          if (!open()) return undefined;
          createRenderEffect(
            () => m(),
            v => {
              screen.branch = v;
            }
          );
          return "span";
        });
        if (extraReader)
          createRenderEffect(
            () => m(),
            v => {
              screen.extra = v;
            }
          );
        return branch;
      },
      () => "[ERR]"
    );
    createRenderEffect(
      () => view(),
      v => {
        screen.view = v;
      }
    );
    return dispose;
  });
  return { act, release: () => release(), screen, dispose };
}

it("heals once the only reader that threw is disposed (#4373)", async () => {
  const t = mount(false);
  flush();
  expect(t.screen.view).toBe(undefined);
  t.act(1);
  flush();
  await tick();
  t.release();
  await tick();
  await tick();
  // The branch closed with the action's settle: nothing reads `m()` — the
  // screen of a fresh render with `s = 1`.
  expect(t.screen.view).toBe(undefined);
  t.dispose();
});

it("stays errored while another live reader holds the error", async () => {
  const t = mount(true);
  flush();
  expect(t.screen.extra).toBe(3);
  t.act(1);
  flush();
  await tick();
  t.release();
  await tick();
  await tick();
  expect(t.screen.view).toBe("[ERR]");
  t.dispose();
});
