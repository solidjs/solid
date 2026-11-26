import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  getOwner,
  latest,
  mapArray,
  runWithOwner,
  untrack
} from "../src/index.js";

const wait = <T>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 5));

function show(when: () => unknown, children: () => unknown) {
  const value = createMemo(() => when());
  const condition = createMemo(value, { equals: (a, b) => !a === !b, sync: true } as any);
  return createMemo(() => (condition() ? children() : undefined), { sync: true } as any);
}

describe("#5211 a mount its owner's lane pass replaced does not hold that lane", () => {
  it("shows the rows once both chained memos resolve", async () => {
    let content: unknown;
    const dispose = createRoot(dispose => {
      const lists = createMemo(() => wait(["l1"]), { loadingValue: undefined });
      const active = createMemo(() => latest(lists)?.[0] ?? null);
      const items = createMemo(
        () => (active() ? wait({ key: active(), rows: ["Milk"] }) : undefined),
        { loadingValue: undefined }
      );
      const rows = () => {
        const r = latest(items);
        return r && r.key === active() ? r.rows : undefined;
      };
      const loading = () => !latest(lists) || (active() !== null && !rows());
      const spinner = show(loading, () => "loading");
      const view = show(
        () => !loading(),
        () =>
          untrack(() => {
            const owner = getOwner();
            let mapped: (() => unknown[]) | undefined;
            const list = () =>
              (mapped ??= runWithOwner(owner, () =>
                mapArray(
                  () => rows() ?? [],
                  row => row
                )
              ))();
            const el: { rows?: unknown } = {};
            createRenderEffect(
              () => list(),
              v => {
                el.rows = v;
              }
            );
            return el;
          })
      );
      createRenderEffect(
        () => [spinner(), view()],
        ([s, v]) => {
          content = s ?? v;
        }
      );
      return dispose;
    });
    flush();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(content).toEqual({ rows: ["Milk"] });
    dispose();
  });
});
