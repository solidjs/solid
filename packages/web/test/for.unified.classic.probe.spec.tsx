/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * CLASSIC BASELINE for the unified-For H1 scenario — driver NOT armed.
 * Pins what mapArray does so the driver suite asserts parity, not fiction.
 */
import { describe, expect, test } from "vitest";
import { createRoot, createOptimisticStore, flush, For } from "solid-js";
import { insert } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("classic H1 baseline — holds and optimism", () => {
  test("held async update never half-applies; in-flight push holds with the flight", async () => {
    const container = document.createElement("div");
    let resolveTruth!: () => void;
    const gate = new Promise<void>(r => (resolveTruth = r));

    let push!: () => void;
    createRoot(() => {
      const [s, ss] = createOptimisticStore<{ id: string }[]>(
        async function* (draft) {
          yield [{ id: "a" }, { id: "b" }];
          await gate;
          yield [{ id: "c" }, { id: "d" }, { id: "e" }];
        },
        [{ id: "a" }, { id: "b" }]
      );
      push = () =>
        ss(draft => {
          draft.push({ id: "opt" });
        });
      insert(
        container,
        () => (<For each={s as any}>{(item: any) => <span>{item.id}</span>}</For>) as any
      );
    });
    flush();
    await sleep(10);
    expect(container.innerHTML).toBe("<span>a</span><span>b</span>");

    // Optimistic structural write DURING the store's own truth flight: the
    // bare write rides the FLIGHT'S transaction (#3146 declared ownership)
    // and holds with it — no flash, no half-applied frame. (Classic mapArray
    // behaves identically — pinned by the classic probe twin of this suite.)
    push();
    flush();
    await sleep(10);
    expect(container.innerHTML).toBe("<span>a</span><span>b</span>");

    // Truth lands: committed topology replaces both the old rows and the
    // optimistic row at the reveal — no intermediate half-applied frame.
    resolveTruth();
    await sleep(20);
    flush();
    expect(container.innerHTML).toBe("<span>c</span><span>d</span><span>e</span>");
  });
});
