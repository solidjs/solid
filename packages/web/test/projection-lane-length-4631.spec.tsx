/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4631: an async memo list filtered by a `createOptimistic` set of closed
// ids, shown through `createProjection(..., { key: "id" })`. After a truth
// landing staged beneath a newer guess, the next close must remove its row
// from the projection as it does from the memo rendered directly (F-6,
// D-25, D-34). See packages/signals/tests/projection-lane-length-4631.test.ts.
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

type Issue = { id: number; t: string };
type Ask = { key: string; res: (v: unknown) => void; rej: (e: unknown) => void };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const proj of [false, true])
  test(`a row closed after a declined guess leaves the ${proj ? "projection" : "memo"}`, async () => {
    const asks: Ask[] = [];
    const ask = <T,>(key: string) =>
      new Promise<T>((res, rej) => asks.push({ key, res: res as (v: unknown) => void, rej }));
    const settle = async (key: string, f: (a: Ask) => void) => {
      const i = asks.findIndex(a => a.key === key);
      f(asks.splice(i, 1)[0]);
      await tick();
    };
    const c = document.body.appendChild(document.createElement("div"));
    const frames: string[] = [];
    const snap = (l: string) => frames.push(`${l}: ${c.textContent}`);
    let close!: (id: number) => unknown;
    const dispose = render(() => {
      const server = createMemo(() => ask<Issue[]>("issues"));
      const [closedTruth, setClosed] = createSignal<number[]>([]);
      const [closed, guess] = createOptimistic<number[]>(() => closedTruth());
      const visible = createMemo(() => server().filter(i => !closed().includes(i.id)));
      const p = createProjection<Issue[]>(() => visible().map(i => ({ id: i.id, t: i.t })), [], {
        key: "id"
      });
      close = action(function* (id: number) {
        try {
          guess(cs => [...cs, id]);
          yield ask(`close:${id}`);
          setClosed(cs => [...cs, id]);
        } catch {}
      });
      return (
        <Loading fallback={<i>loading</i>}>
          <For each={proj ? p : visible()}>
            {(it: Issue | (() => Issue)) => {
              const v = () => (typeof it === "function" ? it() : it);
              return (
                <i>
                  [#{v().id} {v().t}]
                </i>
              );
            }}
          </For>
        </Loading>
      );
    }, c);
    await tick();
    await settle("issues", a =>
      a.res([
        { id: 1, t: "A" },
        { id: 3, t: "C" },
        { id: 4, t: "D" }
      ])
    );
    snap("load");
    close(1);
    await tick();
    await settle("close:1", a => a.rej(new Error("declined")));
    snap("close 1 declined");
    close(4);
    await tick();
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
    snap("at rest");
    dispose();
    c.remove();
    expect(frames).toEqual([
      "load: [#1 A][#3 C][#4 D]",
      "close 1 declined: [#1 A][#3 C][#4 D]",
      "close 1 again: [#3 C]",
      "close 4 accepted: [#3 C]",
      "close 3: ",
      "close 3 accepted: ",
      "at rest: "
    ]);
  });
