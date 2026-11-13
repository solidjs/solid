/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4831: `<For>` over a keyed projection, two `createOptimistic` guess lists
// feeding the projection's memo, a declined close among overlapping assigns,
// then a switch of the list's question. The last re-ask's rows are built by a
// pass of a guess's lane that the seam holds; the correction that ends the
// lane keeps that frame (it showed) but drops the runs the held lane parked.
// The rows' text bindings were born in that frame, so their first runs were
// among the dropped ones and the page showed `<li></li>` rows. A binding born
// in the kept frame now runs on the committed world (F-1).
import { test, expect } from "vitest";
import {
  For,
  Loading,
  action,
  createOptimistic,
  createMemo,
  createSignal,
  createProjection,
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

test("#4831 rows built while guesses are out render their text", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const inAir = new Map<string, Promise<any>>();
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  // A question asked again while it is in the air joins it.
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
  const c = document.body.appendChild(document.createElement("div"));

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
        assignee: assigning().reduce((n: any, x: any) => (x.id === i.id ? x.user : n), i.assignee)
      }))
  );
  const rows = createProjection(() => rowsSrc() as any, [] as any, { key: "id" } as any);
  const showOpen = action(function* () {
    setFilter("open");
  });
  const assignTo = action(function* (id: number, user: string) {
    try {
      guessAssigning((xs: any[]) => [...xs, { id, user }]);
      yield ask(`assign:${user}`);
      refresh(server);
    } catch (e) {}
  });
  const closeOne = action(function* (id: number) {
    try {
      guessClosing((xs: any[]) => [...xs, id]);
      yield ask(`close`);
      refresh(server);
    } catch (e) {}
  });
  render(
    () => (
      <Loading fallback={<p>loading</p>}>
        <ul>
          <For each={rows as any}>
            {(it: any) => <li>{`#${it.id} ${it.title} (${it.assignee})`}</li>}
          </For>
        </ul>
      </Loading>
    ),
    c
  );

  // A fresh list each landing, as a fetch returns.
  const open = () => [
    { id: 1, title: "Login fails", assignee: null },
    { id: 3, title: "Crash on save", assignee: null }
  ];
  const steps: [string, () => void][] = [
    ["mount", () => {}],
    ["closed list lands", () => pick("closed").res([{ id: 2, title: "Old bug", assignee: "eve" }])],
    ["assign #2 ann", () => assignTo(2, "ann")],
    ["close #2", () => closeOne(2)],
    ["assign #2 guest", () => assignTo(2, "guest")],
    // re-asks the closed list
    ["that assign lands", () => pick("assign:guest").res({})],
    ["close declined", () => pick("close").rej(new Error("declined"))],
    ["assign #2 guest again", () => assignTo(2, "guest")],
    // re-asks the closed list (joins the one in the air)
    ["assign ann lands", () => pick("assign:ann").res({})],
    ["switch to open", () => showOpen()],
    ["open list lands", () => pick("open").res(open())],
    // re-asks the open list
    ["second assign lands", () => pick("assign:guest").res({})],
    ["open list lands again", () => pick("open").res(open())]
  ];
  const frames: string[] = [];
  for (const [n, f] of steps) {
    f();
    await tick();
    frames.push(`${n}: ${c.innerHTML}`);
  }
  expect(frames.at(-1)).toBe(
    "open list lands again: <ul><li>#1 Login fails (null)</li><li>#3 Crash on save (null)</li></ul>"
  );
  // Every row on the page has its text.
  for (const f of frames) expect(f).not.toContain("<li></li>");
  c.remove();
});
