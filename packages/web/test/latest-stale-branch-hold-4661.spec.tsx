/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// #4661: a memo outside `<Loading on={f()}>` whose last run read
// `latest(() => list())` no longer holds the switch when its new run takes the
// branch that does not read `list` (F-6: a display-ahead read never holds the
// change it reads ahead of). The fallback shows at once; the count keeps its
// committed value until `list`'s answer lands — "It should read the committed
// value, we can't reveal early outside of latest. This is intentional
// tearing." (maintainer, 2026-11-03). The issue's table had `[-1]` meanwhile.

import { expect, test } from "vitest";
import { Loading, createEffect, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

function app(reader: "effect" | "view") {
  const asks = new Map<string, (v: number[]) => void>();
  const ask = (key: string) => new Promise<number[]>(res => asks.set(key, res));
  let seen: number | undefined;
  let setF!: (v: string) => void;
  const div = document.createElement("div");
  const dispose = render(() => {
    const [f, set] = createSignal("open");
    setF = set;
    const list = createMemo(() => ask(`list:${f()}`));
    const count = createMemo(() => (f() === "open" ? latest(() => list().length) : -1));
    if (reader === "effect")
      createEffect(
        () => count(),
        v => {
          seen = v;
        }
      );
    return (
      <>
        {reader === "view" ? <span>{`[${count()}]`}</span> : null}
        <Loading fallback={<i>first</i>}>
          <Loading on={f()} fallback={<i>loading {f()}</i>}>
            <b>{list().join(",")}</b>
          </Loading>
        </Loading>
      </>
    );
  }, div);
  return {
    div,
    dispose,
    seen: () => seen,
    setF: (v: string) => setF(v),
    land: (key: string, v: number[]) => asks.get(key)!(v)
  };
}

test("latest() in the branch taken before the switch, read by an effect (#4661)", async () => {
  const a = app("effect");
  flush();
  a.land("list:open", [1, 2, 3]);
  await settle();
  expect(a.div.innerHTML).toBe("<b>1,2,3</b>");
  expect(a.seen()).toBe(3);
  a.setF("closed");
  flush();
  await settle();
  expect(a.div.innerHTML).toBe("<i>loading closed</i>");
  expect(a.seen()).toBe(3);
  a.land("list:closed", [9]);
  await settle();
  expect(a.div.innerHTML).toBe("<b>9</b>");
  expect(a.seen()).toBe(-1);
  a.dispose();
});

test("latest() in the branch taken before the switch, read by a view outside the boundary (#4661)", async () => {
  const a = app("view");
  flush();
  a.land("list:open", [1, 2, 3]);
  await settle();
  expect(a.div.innerHTML).toBe("<span>[3]</span><b>1,2,3</b>");
  a.setF("closed");
  flush();
  await settle();
  expect(a.div.innerHTML).toBe("<span>[3]</span><i>loading closed</i>");
  a.land("list:closed", [9]);
  await settle();
  expect(a.div.innerHTML).toBe("<span>[-1]</span><b>9</b>");
  a.dispose();
});
