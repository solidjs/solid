// #4840: a keyed list renders one detail for the selection; the detail's
// heading memo reads the async detail and a `createOptimistic` guess whose
// action never returns. Changing the selection made the old heading's binding
// a reader of the guess lane's member while that member's own flight (the new
// detail) was up: served the screen, it was queued to re-derive at the lane's
// next reveal. The lane had shown and was not held, so it revealed at every
// seam, each re-derivation read the same flight and queued the next, and the
// flush never settled ("Potential Infinite Loop Detected"; a hang in prod).
// A reader waiting on a shown, unheld lane's flight re-derives when that
// flight lands, not at the next reveal. The DOM version is
// packages/web/test/for-selection-loop-4840.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4840 changing a keyed selection while a guess its rows read is out settles", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
    return asks.splice(i, 1)[0];
  };
  let screen: any[] = [];
  let setSelected!: (v: number | null) => void;
  let rename!: (id: number, title: string) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [selected, setSel] = createSignal<number | null>(null);
    setSelected = setSel;
    const [renaming, guessRename] = createOptimistic<{ id: number; title: string }[]>(() => []);
    const detail = createMemo(() => (selected() != null ? ask(`detail:${selected()}`) : undefined));
    const heading = createMemo(() => {
      const d: any = detail();
      return d == null ? "" : renaming().reduce((t, r) => (r.id === d.id ? r.title : t), d.title);
    });
    const selList = createMemo(() => (selected() == null ? [] : [selected()]));
    rename = action(function* (id: number, title: string) {
      guessRename(rs => [...rs, { id, title }]);
      yield ask(`rename:${id}`); // never answers
    });
    // <Page><For each={selList()}>{s => <Detail id={s} />}</For></Page>,
    // Page = p => <>{p.children}</>, Detail = a Loading over <h2> and <p>.
    const rows = mapArray(
      () => selList(),
      (s: any) =>
        createLoadingBoundary(
          () => {
            const h2 = { text: "" },
              p = { text: "" };
            createRenderEffect(
              () => `#${s} ${heading()}`,
              v => void (h2.text = v)
            );
            createRenderEffect(
              () => (detail() as any)?.body,
              v => void (p.text = v)
            );
            return [h2, p];
          },
          () => `loading #${s}`
        )
    );
    const children = createMemo(() => rows());
    createRenderEffect(
      () => children().map(b => b()),
      v => void (screen = v)
    );
    return undefined;
  });
  const view = () =>
    screen.map(v => (typeof v === "string" ? v : v.map((x: any) => x.text).join("|"))).join(",");
  const frames: string[] = [];
  setSelected(4);
  await tick();
  frames.push(view());
  rename(4, "Bravo");
  await tick();
  pick("detail:4").res({ id: 4, title: "Typo in footer", body: "four" });
  await tick();
  frames.push(view());
  setSelected(3);
  await tick();
  frames.push(view());
  pick("detail:3").res({ id: 3, title: "Crash on save", body: "three" });
  await tick();
  frames.push(view());
  expect(frames).toEqual(["loading #4", "#4 Bravo|four", "loading #3", "#3 Crash on save|three"]);
  dispose();
});
