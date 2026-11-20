// #5090: a memo over a row of one optimistic list, that also reads another
// list whose refresh() re-ask is out, shows a fresh guess on the row as the
// binding beside it does (F-1, F-11; a re-ask holds nothing new, D-34 ¶3).
// The web version is packages/web/test/guess-memo-reask-other-list-5090.spec.tsx.
import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const V of ["base", "no-a-reask", "skip-a", "direct"]) {
  test(`#5090 ${V}: a rename guessed while a move's re-asks are out shows in the row and in the detail memo`, async () => {
    const asks: { k: string; res: (v: any) => void }[] = [];
    const ask = (k: string) => new Promise<any>(res => asks.push({ k, res }));
    const take = (k: string) => {
      const i = asks.findIndex(a => a.k === k);
      if (i < 0) throw new Error(`no ask ${k} in ${asks.map(a => a.k)}`);
      return asks.splice(i, 1)[0];
    };
    const server: Record<string, any[]> = {
      a: [{ id: 1, t: "W" }],
      b: [{ id: 4, t: "D" }],
      c: [{ id: 5, t: "K" }]
    };
    const shown: Record<number, string> = {};
    let detail: string | null = null;
    let api: any;
    const dispose = createRoot(dispose => {
      const L: Record<string, any> = {};
      for (const k of ["a", "b", "c"]) {
        const [ans] = createSignal(async () => await ask(k), { loadingValue: null } as any);
        const [rows, setRows] = createOptimisticStore(
          () => ans() ?? [],
          [] as any[],
          {
            key: "id"
          } as any
        );
        L[k] = { ans, rows, setRows };
      }
      // The detail finds its row: which list holds #5, then the row in it.
      const where = createMemo(
        () =>
          (V === "skip-a" ? ["b", "c"] : ["a", "b", "c"]).find(k =>
            L[k].rows.some((r: any) => r.id === 5)
          ) ?? ""
      );
      const sel = createMemo(() => (where() ? L[where()].rows.find((r: any) => r.id === 5) : null));
      // What JSX's `{s().t}` in a fragment builds: a memo between.
      const title = createMemo(() => (sel() ? sel().t : null));
      const move = action(function* () {
        const row = { ...L.c.rows[0] };
        L.c.setRows((rs: any[]) => rs.filter(r => r.id !== 5));
        L.b.setRows((rs: any[]) => [...rs, row]);
        yield ask("move");
        server.b = [...server.b, server.c[0]];
        server.c = [];
        if (V !== "no-a-reask") refresh(L.a.ans);
        refresh(L.b.ans);
        refresh(L.c.ans);
      });
      const rename = action(function* (t: string) {
        L.b.setRows((rs: any[]) => {
          rs[rs.length - 1].t = t;
        });
        yield ask("rename");
        server.b = server.b.map(r => (r.id === 5 ? { ...r, t } : r));
        refresh(L.b.ans);
      });
      api = { move, rename };
      const rows = mapArray(
        () => L.b.rows,
        (r: any) => {
          createRenderEffect(
            () => [r.id, r.t],
            ([id, t]) => {
              shown[id] = t;
            }
          );
          return r;
        }
      );
      createRenderEffect(rows, () => {});
      createRenderEffect(
        () => (V === "direct" ? (sel() ? sel().t : null) : title()),
        t => {
          detail = t;
        }
      );
      return dispose;
    });
    flush();
    await tick();
    for (const k of ["a", "b", "c"]) take(k).res(structuredClone(server[k]));
    await tick();
    api.move();
    await tick();
    take("move").res(true); // accepted: the re-asks are out
    await tick();
    api.rename("A"); // rename #5, now last in b
    await tick();
    expect({ row: shown[5], detail }).toEqual({ row: "A", detail: "A" });

    // Everything answers: the screen settles on the server's rows.
    take("rename").res(true);
    await tick();
    while (asks.length) {
      const k = asks[0].k;
      take(k).res(structuredClone(server[k]));
      await tick();
    }
    expect({ row: shown[5], detail }).toEqual({ row: "A", detail: "A" });
    dispose();
  });
}
