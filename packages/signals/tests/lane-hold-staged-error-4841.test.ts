// #4841: a detail memo keyed on a selection fails while other actions are
// out; the heading memo reads the detail and a `createOptimistic` rename
// guess. The failure lands on a node an entangled action holds, so it is
// staged (D-41), and the settle walk marked every derivation of it — the
// heading too, a member of the rename's guess lane. That lane had shown and
// was not held, so its seam published the hold's error at once: `<Errored>`
// flipped ahead of the hold, and when the re-ask's answer landed (still
// held) the boundary recovered in the lane over the committed detail of the
// previous selection (`#3 Alpha (detail of #4)`). A lane reader carries a
// staged error only from a guess of another lane: a truth's staging is the
// hold's, shown at its reveal. Reading the guess no longer changes what shows
// (the plain heading never flipped). The DOM version is
// packages/web/test/failed-reask-stale-detail-4841.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(readGuess: boolean) {
  const asks: { key: string; p: Promise<any>; res: (v: any) => void; rej: (e: any) => void }[] = [];
  // One flight per key while it is out.
  const ask = (key: string) => {
    const o = asks.find(a => a.key === key);
    if (o) return o.p;
    let res: any, rej: any;
    const p = new Promise<any>((a, b) => ((res = a), (rej = b)));
    asks.push({ key, p, res, rej });
    return p;
  };
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
    return asks.splice(i, 1)[0];
  };
  const frames: string[] = [];
  let screen = "";
  let select!: (id: number) => void;
  let rename!: (id: number, title: string) => void;
  let close!: (id: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [selected, setSelected] = createSignal<number | null>(null);
    const [renaming, guessRename] = createOptimistic<{ id: number; title: string }[]>(() => []);
    const [, guessClose] = createOptimistic<number[]>(() => []);
    const list = createMemo(() => ask("list"));
    const answer = createMemo(() => (selected() != null ? ask(`detail:${selected()}`) : undefined));
    const detail = createMemo(() => (selected() == null ? null : answer()));
    const heading = createMemo(() => {
      const d: any = detail();
      if (d == null) return "";
      return readGuess
        ? renaming().reduce((t, r) => (r.id === d.id ? r.title : t), d.title)
        : d.title;
    });
    select = action(function* (id: number) {
      setSelected(id);
    });
    rename = action(function* (id: number, title: string) {
      guessRename(rs => [...rs, { id, title }]);
      yield ask(`rename:${id}`);
      refresh(list);
      refresh(answer);
      refresh(detail);
    });
    close = action(function* (id: number) {
      guessClose(cs => [...cs, id]);
      yield ask(`close:${id}`);
      refresh(list);
    });
    // <Show when={selected() != null}><Loading on={selected()}><Errored>
    //   <h2>#{selected()} {heading()} (detail of #{detail()?.id})</h2>
    const shown = createMemo(() => selected() != null);
    const view = createMemo(() =>
      shown()
        ? createLoadingBoundary(
            () =>
              createErrorBoundary(
                () => {
                  // One binding per hole, as the compiled template inserts them.
                  const holes = ["", "", ""];
                  const h2 = {
                    get text() {
                      return `#${holes[0]} ${holes[1]} (detail of #${holes[2]})`;
                    }
                  };
                  createRenderEffect(selected, v => void (holes[0] = String(v)));
                  createRenderEffect(heading, v => void (holes[1] = v));
                  createRenderEffect(
                    () => (detail() as any)?.id,
                    v => void (holes[2] = String(v))
                  );
                  return h2;
                },
                e => ({ text: `detail error: ${(e() as any)?.message}` })
              ),
            () => ({ text: `loading #${selected()}` }),
            { on: () => selected() }
          )
        : () => ({ text: "select" })
    );
    createRenderEffect(
      () => (view() as any)(),
      v => void (screen = v)
    );
  });
  const issues = [
    { id: 1, title: "Login fails" },
    { id: 3, title: "Crash on save" },
    { id: 4, title: "Typo in footer" }
  ];
  const steps: [string, () => void][] = [
    ["list lands", () => pick("list").res(issues)],
    ["select #4", () => select(4)],
    ["rename #4", () => rename(4, "Alpha")],
    ["detail #4 lands", () => pick("detail:4").res({ id: 4, title: "Typo in footer" })],
    ["select #3", () => select(3)],
    ["close #3", () => close(3)],
    ["close #4", () => close(4)],
    ["rename #3", () => rename(3, "Delta")],
    ["rename #4 lands", () => pick("rename:4").res({})],
    ["detail #3 fails", () => pick("detail:3").rej(new Error("declined"))],
    ["close #4 lands", () => pick("close:4").res({})],
    ["rename #3 lands", () => pick("rename:3").res({})],
    ["detail #3 lands", () => pick("detail:3").res({ id: 3, title: "Delta" })],
    ["close #3 lands", () => pick("close:3").res({})]
  ];
  for (const [n, f] of steps) {
    f();
    await tick();
    frames.push(`${n}: ${(screen as any)?.text}`);
  }
  dispose();
  return frames;
}

test("#4841 a lane does not show a hold's staged error, nor the previous selection's detail after", async () => {
  const frames = await run(true);
  expect(frames.slice(9)).toEqual([
    "detail #3 fails: loading #3",
    "close #4 lands: loading #3",
    "rename #3 lands: loading #3",
    "detail #3 lands: loading #3",
    "close #3 lands: #3 Delta (detail of #3)"
  ]);
  // Reading the guess changes nothing about what shows (F-3).
  expect(frames).toEqual((await run(false)).map(f => f.replace("#4 Typo in footer", "#4 Alpha")));
});
