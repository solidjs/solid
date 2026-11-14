/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4841: a detail memo keyed on the selection fails while other actions are
// out, and a rename's refresh asks it again. The heading reads the detail and
// a `createOptimistic` rename guess, which made it a member of the guess's
// lane: the lane published the failure the actions still held (`<Errored>`
// flipped early), and when the re-ask's answer landed, still held, the
// boundary recovered in the lane over the previous selection's committed
// detail (`#3 Alpha (detail of #4)`). The hold's error is now the hold's: the
// screen stays `loading #3` until the last action lands, as it does when the
// heading reads `d.title` plainly. The signals version is
// packages/signals/tests/lane-hold-staged-error-4841.test.ts.
import { test, expect } from "vitest";
import {
  Loading,
  Errored,
  Show,
  action,
  createOptimistic,
  createMemo,
  createSignal,
  refresh,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(readGuess: boolean) {
  const asks: { key: string; p: Promise<any>; res: (v: any) => void; rej: (e: any) => void }[] = [];
  // One flight per key while it is out, like the app's backend plumbing.
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
  const c = document.body.appendChild(document.createElement("div"));
  const frames: string[] = [];

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

  const select = action(function* (id: number) {
    setSelected(id);
  });
  const rename = action(function* (id: number, title: string) {
    guessRename(rs => [...rs, { id, title }]);
    yield ask(`rename:${id}`);
    refresh(list);
    refresh(answer);
    refresh(detail);
  });
  const close = action(function* (id: number) {
    guessClose(cs => [...cs, id]);
    yield ask(`close:${id}`);
    refresh(list);
  });

  const dispose = render(
    () => (
      <main>
        <Show when={selected() != null} fallback={<p>select</p>}>
          <Loading on={selected()} fallback={<p>loading #{selected()}</p>}>
            <Errored fallback={(e: any) => <p>detail error: {e()?.message}</p>}>
              <h2>
                #{selected()} {heading()} (detail of #{(detail() as any)?.id})
              </h2>
            </Errored>
          </Loading>
        </Show>
      </main>
    ),
    c
  );

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
    frames.push(`${n}: ${c.firstElementChild!.textContent}`);
  }
  dispose();
  c.remove();
  return frames;
}

test("#4841 after a failed detail is asked again, the screen never shows the previous selection's detail", async () => {
  const frames = await run(true);
  expect(frames.slice(9)).toEqual([
    "detail #3 fails: loading #3",
    "close #4 lands: loading #3",
    "rename #3 lands: loading #3",
    "detail #3 lands: loading #3",
    "close #3 lands: #3 Delta (detail of #3)"
  ]);
  // Reading the guess changes nothing about when the detail shows (F-3).
  expect(frames).toEqual((await run(false)).map(f => f.replace("#4 Typo in footer", "#4 Alpha")));
});
