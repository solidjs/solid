import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

// #4631: a list from an async memo, filtered by a `createOptimistic` set of
// closed ids, shown through a keyed projection. A truth landing staged
// beneath a newer guess holds the projection's leaves (its `length` among
// them); the next guess's lane pass then re-derives the list. That pass is
// the lane's derivation (F-6, D-25: the leaves show it now, as a memo's
// reader would), so the length must follow the container into the lane —
// staged into the hold instead, the screen paired the truth's length with
// the guess's rows (D-34): the closed row stayed, read as `#undefined`.
// The declined first close of the report is not needed to get there; both
// shapes are pinned, and the memo rendered directly is the reference.
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const declined of [true, false])
  for (const proj of [false, true])
    it(`#4631 a row closed under a held landing leaves the ${proj ? "projection" : "memo"} (declined first: ${declined})`, async () => {
      const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
      const settle = async (key: string, f: (a: any) => void) => {
        const i = asks.findIndex(a => a.key === key);
        f(asks.splice(i, 1)[0]);
        await tick();
      };
      const frames: string[] = [];
      let view: () => string = () => "";
      const snap = (l: string) => frames.push(`${l}: ${view()}`);
      let close!: (id: number) => any;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const server = createMemo(() => ask("issues"));
        const [closedTruth, setClosed] = createSignal<number[]>([]);
        const [closed, guess] = createOptimistic<number[]>(() => closedTruth());
        const visible = createMemo(() =>
          (server() as any[]).filter((i: any) => !closed().includes(i.id))
        );
        const p = proj
          ? createProjection(
              () => visible().map((i: any) => ({ id: i.id, t: i.t })) as any,
              [] as any,
              { key: "id" } as any
            )
          : null;
        close = action(function* (id: number) {
          try {
            guess(cs => [...cs, id]);
            yield ask(`close:${id}`);
            setClosed(cs => [...cs, id]);
          } catch {}
        });
        const list = () =>
          mapArray(
            () => (proj ? p : visible()) as any[],
            (it: any) => {
              const s = { v: "" };
              createRenderEffect(
                () => {
                  const x = typeof it === "function" ? it() : it;
                  return `[#${x?.id} ${x?.t}]`;
                },
                v => {
                  s.v = v;
                }
              );
              return s;
            }
          );
        const b = createLoadingBoundary(list, () => "loading");
        createRenderEffect(
          () => {
            const v: any = b();
            return typeof v === "function" ? v() : v;
          },
          (v: any) => {
            view = () => (typeof v === "string" ? v : v.map((s: any) => s.v).join(""));
          }
        );
      });
      await tick();
      await settle("issues", a =>
        a.res([
          { id: 1, t: "A" },
          { id: 3, t: "C" },
          { id: 4, t: "D" }
        ])
      );
      snap("load");
      if (declined) {
        close(1);
        await tick();
        snap("close 1");
        await settle("close:1", a => a.rej(new Error("declined")));
        snap("close 1 declined");
      }
      close(4);
      await tick();
      snap("close 4");
      close(1);
      await tick();
      snap("close 1 again");
      await settle("close:4", a => a.res({}));
      snap("close 4 accepted");
      close(3);
      await tick();
      snap("close 3");
      await settle("close:3", a => a.res({}));
      snap("close 3 accepted");
      await settle("close:1", a => a.res({}));
      snap("close 1 accepted");
      dispose();
      expect(frames).toEqual([
        "load: [#1 A][#3 C][#4 D]",
        ...(declined ? ["close 1: [#3 C][#4 D]", "close 1 declined: [#1 A][#3 C][#4 D]"] : []),
        "close 4: [#1 A][#3 C]",
        "close 1 again: [#3 C]",
        "close 4 accepted: [#3 C]",
        "close 3: ",
        "close 3 accepted: ",
        "close 1 accepted: "
      ]);
    });
