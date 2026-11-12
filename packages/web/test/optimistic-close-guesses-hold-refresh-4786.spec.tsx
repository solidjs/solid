/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4786: two close guesses on a `createOptimistic` list of hidden ids, each
// refreshing a keyed optimistic store after its write. A third action's field
// guess on that store stands in (A17) for the refetch the closes asked for
// (D-34 ¶3: the same question), so the list read nothing pending and the
// closes' hold landed while its refetch was out: both closed rows came back.
// The pass the guess serves still derives from that refetch, a stale reader
// of it (A15), so the closes hold until it answers (F-11).
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
  createOptimistic,
  createOptimisticStore,
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

for (const withAssign of [true, false])
  test(`#4786 two close guesses hold until the refresh lands (${withAssign ? "with" : "without"} a field guess on the store)`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));
    const frames: string[] = [];
    const snap = () => frames.push(c.textContent || "(empty)");
    let close!: (id: number) => any, assign!: (id: number) => any;
    const dispose = render(() => {
      const [issues, setIssues] = createOptimisticStore(
        async (d: any) => {
          const v = await ask("fetch");
          d.splice(0, d.length, ...v);
        },
        [] as any[],
        { key: "id" } as any
      );
      const [truth] = createSignal<number[]>(() => []);
      const [hidden, guessHidden] = createOptimistic(() => truth());
      const shown = createMemo(() => issues.filter((i: any) => !hidden().includes(i.id)));
      close = action(function* (id: number) {
        guessHidden(h => [...h, id]);
        yield ask(`close:${id}`);
        refresh(issues);
      });
      assign = action(function* (id: number) {
        setIssues((d: any) => {
          d.find((x: any) => x.id === id).a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(issues);
      });
      return (
        <Loading fallback={<i>loading</i>}>
          <For each={shown()}>{r => <i>[#{r.id}]</i>}</For>
        </Loading>
      );
    }, c);
    await tick();
    pick("fetch").res([
      { id: 1, a: "" },
      { id: 4, a: "dana" }
    ]);
    await tick();
    snap();
    close(1);
    await tick();
    snap();
    if (withAssign) {
      assign(4);
      await tick();
    }
    close(4);
    await tick();
    snap();
    pick("close:4").res({});
    await tick();
    snap();
    pick("close:1").res({});
    await tick();
    snap();
    if (withAssign) {
      pick("assign:4").res({});
      await tick();
      snap();
    }
    // The server closed both: every refetch answers an empty list.
    while (asks.length) {
      for (const a of asks.splice(0)) a.res([]);
      await tick();
    }
    snap();
    dispose();
    c.remove();
    expect(frames).toEqual(
      withAssign
        ? ["[#1][#4]", "[#4]", "(empty)", "(empty)", "(empty)", "(empty)", "(empty)"]
        : ["[#1][#4]", "[#4]", "(empty)", "(empty)", "(empty)", "(empty)"]
    );
  });
