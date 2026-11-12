/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4762 (follow-up): a filter switch from outside, made while guesses on one
// `createOptimistic` are out, under `<Loading on={filter()}>`. The switch needs
// its fetch (F-2): the armed boundary shows its fallback (F-4) and nothing of
// the switch shows before the fetch lands, nor a guess goes missing (F-11).
// With two guesses out and one action landing after the switch, that action's
// write reads the pending fetch and joins the switch's hold, and its guess
// shares a slot with the other action's (D-33): the switch lands with the last
// of them. Shapes: plain memos, a keyed projection of the rows (inner), one of
// the filtered view (outer), or both (the issue's).
import { expect, test } from "vitest";
import {
  For,
  Loading,
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createSignal,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Shape = "memos" | "inner" | "outer" | "both";

async function run(shape: Shape, guesses: 1 | 2, fetchFirst: boolean): Promise<string[]> {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, `${key} asked`).not.toBe(-1);
    return asks.splice(i, 1)[0];
  };
  const c = document.body.appendChild(document.createElement("div"));
  let close!: (id: number) => any, setFilter!: (f: string) => void;
  const dispose = render(() => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const server = createMemo(() => ask(`fetch:${filter()}`));
    const [acceptedClosed, setAcceptedClosed] = createSignal<number[]>([]);
    const issuesSrc = createMemo(() =>
      (server() as any[]).map(x => ({ ...x, gone: acceptedClosed().includes(x.id) }))
    );
    const issues: any =
      shape === "inner" || shape === "both"
        ? createProjection(() => issuesSrc(), [] as any[], { key: "id" })
        : null;
    const rows = () => issues ?? issuesSrc();
    const [closingTruth] = createSignal<number[]>(() => []);
    const [closing, guessClose] = createOptimistic(() => closingTruth());
    const view = createMemo(() =>
      filter() === "open" ? rows().filter((r: any) => !r.gone && !closing().includes(r.id)) : rows()
    );
    const shown: any =
      shape === "outer" || shape === "both"
        ? createProjection(() => view(), [] as any[], { key: "id" })
        : null;
    close = action(function* (id: number) {
      guessClose((xs: number[]) => [...xs, id]);
      yield ask(`close:${id}`);
      setAcceptedClosed(xs => [...xs, id]);
    });
    return (
      <Loading on={filter()} fallback={<i>loading</i>}>
        <For each={shown ?? view()}>{(r: any) => <i>[#{r.id}]</i>}</For>
      </Loading>
    );
  }, c);
  const seen: string[] = [];
  const step = async (label: string, act: () => void) => {
    act();
    await tick();
    seen.push(`${label} ${c.textContent}`);
  };
  try {
    await tick();
    pick("fetch:open").res([{ id: 1 }, { id: 3 }, { id: 4 }]);
    await tick();
    await step("guess", () => close(4));
    if (guesses === 2) await step("guess", () => close(1));
    await step("switch", () => setFilter("closed"));
    if (fetchFirst) {
      await step("fetch", () => pick("fetch:closed").res([{ id: 2 }, { id: 4 }]));
      await step("land", () => pick("close:4").res({}));
    } else {
      await step("land", () => pick("close:4").res({}));
      await step("fetch", () => pick("fetch:closed").res([{ id: 2 }, { id: 4 }]));
    }
    if (guesses === 2) await step("land", () => pick("close:1").res({}));
    return seen;
  } finally {
    // Nothing left open for the next test, whatever this one saw.
    for (const a of asks.splice(0)) a.res([]);
    await tick();
    dispose();
    c.remove();
  }
}

const one = ["guess [#1][#3]", "switch loading"];
const two = ["guess [#1][#3]", "guess [#3]", "switch loading"];
const cases: [Shape, 1 | 2, boolean, string[]][] = [];
for (const shape of ["memos", "inner", "outer", "both"] as Shape[]) {
  cases.push([shape, 1, false, [...one, "land loading", "fetch [#2][#4]"]]);
  cases.push([shape, 2, true, [...two, "fetch [#2][#4]", "land [#2][#4]", "land [#2][#4]"]]);
  cases.push([
    shape,
    2,
    false,
    // close(4)'s write joined the switch's hold; close(1) shares its slot.
    [...two, "land loading", "fetch loading", "land [#2][#4]"]
  ]);
}

for (const [shape, guesses, fetchFirst, expected] of cases)
  test(`${shape}: ${guesses} guess${guesses === 2 ? "es" : ""} out, ${
    fetchFirst ? "the fetch lands first" : "an action lands before the fetch"
  }`, async () => {
    expect(await run(shape, guesses, fetchFirst)).toEqual(expected);
  });
