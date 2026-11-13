// #4831: rows a held lane's pass built keep their frame when a correction
// ends the lane (it showed), but the runs the held lane parked are dropped.
// A render effect born in that frame owes its first run all the same: it
// runs on the committed world (F-1, the screen is whole). The DOM version is
// packages/web/test/blank-rows-4831.spec.tsx.
import { test, expect } from "vitest";
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
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4831 rows built while guesses are out run their bindings", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const inAir = new Map<string, Promise<any>>();
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const askQ = (key: string) => {
    let p = inAir.get(key);
    if (!p) {
      p = ask(key).finally(() => inAir.delete(key));
      inAir.set(key, p);
    }
    return p;
  };
  const pick = (key: string) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
    return asks.splice(i, 1)[0];
  };
  let screen: { text: string }[] | string = [];
  const view = () => (typeof screen === "string" ? screen : screen.map(r => r.text));
  let showOpen!: () => void, assignTo!: (id: number, user: string) => void;
  let closeOne!: (id: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [filter, setFilter] = createSignal("closed");
    const server = createMemo(() => askQ(filter()));
    const [assigningT] = createSignal<{ id: number; user: string }[]>(() => []);
    const [assigning, guessAssigning] = createOptimistic(() => assigningT());
    const [closingT] = createSignal<number[]>(() => []);
    const [closing, guessClosing] = createOptimistic(() => closingT());
    const rowsSrc = createMemo(() =>
      (server() as any[])
        .filter(i => !closing().includes(i.id))
        .map(i => ({
          id: i.id,
          title: i.title,
          assignee: assigning().reduce((n, x) => (x.id === i.id ? x.user : n), i.assignee)
        }))
    );
    const rows = createProjection(() => rowsSrc() as any, [] as any, { key: "id" } as any);
    showOpen = action(function* () {
      setFilter("open");
    });
    assignTo = action(function* (id: number, user: string) {
      try {
        guessAssigning(xs => [...xs, { id, user }]);
        yield ask(`assign:${user}`);
        refresh(server);
      } catch (e) {}
    });
    closeOne = action(function* (id: number) {
      try {
        guessClosing(xs => [...xs, id]);
        yield ask(`close`);
        refresh(server);
      } catch (e) {}
    });
    // <Loading><For each={rows}>{it => <li>{text}</li>}</For></Loading>
    const b = createLoadingBoundary(
      () =>
        mapArray(
          () => rows as any,
          (it: any) => {
            const row = { text: "" };
            createRenderEffect(
              () => `#${it.id} ${it.title} (${it.assignee})`,
              v => void (row.text = v)
            );
            return row;
          }
        ),
      () => "loading"
    );
    createRenderEffect(
      () => {
        const v = b();
        return typeof v === "function" ? v() : v;
      },
      v => void (screen = v)
    );
    return d;
  });
  // A fresh list each landing, as a fetch returns.
  const open = () => [
    { id: 1, title: "Login fails", assignee: null },
    { id: 3, title: "Crash on save", assignee: null }
  ];
  const steps: (() => void)[] = [
    () => {},
    () => pick("closed").res([{ id: 2, title: "Old bug", assignee: "eve" }]),
    () => assignTo(2, "ann"),
    () => closeOne(2),
    () => assignTo(2, "guest"),
    () => pick("assign:guest").res({}),
    () => pick("close").rej(new Error("declined")),
    () => assignTo(2, "guest"),
    () => pick("assign:ann").res({}),
    () => showOpen(),
    () => pick("open").res(open()),
    () => pick("assign:guest").res({}),
    () => pick("open").res(open())
  ];
  const frames: unknown[] = [];
  for (const f of steps) {
    f();
    await tick();
    frames.push(view());
  }
  expect(frames).toEqual([
    "loading",
    ["#2 Old bug (eve)"],
    ["#2 Old bug (ann)"],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    ["#1 Login fails (null)", "#3 Crash on save (null)"]
  ]);
  dispose();
});
