/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { Loading, action, createOptimistic, createSignal, refresh, flush } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
// #4795: a guess made while its source is loading a new question (the selection just changed).
for (const kind of ["object", "array"] as const)
  test(`guess while the source loads a new question (${kind})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const c = document.body.appendChild(document.createElement("div"));
    const frames: string[] = [];
    const snap = (l: string) => frames.push(`${l.padEnd(26)} ${c.textContent}`);
    let select!: (id: number) => void, write!: () => any;
    render(() => {
      const [sel, setSel] = createSignal(0);
      const [truth] = createSignal<any>(() =>
        sel() === 0 ? (kind === "object" ? null : []) : ask(`fetch:${sel()}`)
      );
      const [shown, guess] = createOptimistic(() => truth());
      select = setSel;
      write = action(function* () {
        if (kind === "object") guess((d: any) => (d == null ? null : { ...d, title: "Bravo" }));
        else guess((cs: any[]) => [...cs, "ping"]);
        yield ask("write");
        refresh(truth);
      });
      return (
        <Loading on={sel()} fallback={<i>loading</i>}>
          {kind === "object" ? <b>{shown()?.title ?? "-"}</b> : <b>{shown().join(",")}</b>}
        </Loading>
      );
    }, c);
    await tick();
    snap("start");
    select(3);
    await tick();
    snap("select #3");
    write();
    await tick();
    snap("write while #3 loads");
    pick("fetch:3").res(kind === "object" ? { title: "Old bug" } : ["seen it too"]);
    await tick();
    snap("#3 lands, write out");
    pick("write").res(undefined);
    await tick();
    snap("write lands");
    const f = asks.find(a => a.key === "fetch:3");
    f?.res(kind === "object" ? { title: "Bravo" } : ["seen it too", "ping"]);
    await tick();
    snap("refetch lands");
    c.remove();
    // D-34: a guess the screen never showed is void at the correction (the
    // object guess, made while the fallback showed); a shown one stays the
    // screen until its hold commits (the array guess, shown in place of the
    // fallback), and the commit lands the truth beneath it.
    expect(frames.map(f => f.slice(27))).toEqual(
      kind === "object"
        ? ["-", "loading", "loading", "Old bug", "Old bug", "Bravo"]
        : ["", "loading", "ping", "ping", "ping", "seen it too,ping"]
    );
  });
