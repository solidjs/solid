/**
 * #4643: an optimistic todo list with an "N left" memo never settled. A
 * memo seated in one lane (its guess's) whose pass read through a lane
 * linked to it, re-based over a parked frame's answer (#4525, `over`), read
 * that frame's staging there (#4536). The seam re-derived it on the
 * committed world (`stagedReaders`): its re-run re-entered the linked lane,
 * read the staging again and parked again, every round: "Potential Infinite
 * Loop Detected ... last staged node: computed". The seam's #4536 carve-out
 * looked only at the memo's own lane; the link group (one reveal unit) counts.
 *
 * Every landing settles (the Hold ends with one frame that reveals the
 * change; D-33: the hold commits), each frame shows the list and its count
 * together (D-37), and the end is the server's list.
 *
 * The issue's second shape (an inbox: a filter memo over a polled list,
 * optimistic deletes) looped the same way ("last staged node: signal").
 */
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function fakeServer<T extends { id: number }>(rows: T[]) {
  const server = { rows };
  const out: { key: string; go: () => void }[] = [];
  const call = (key: string, apply?: () => void) =>
    new Promise<any>(resolve =>
      out.push({
        key,
        go: () => {
          apply?.();
          resolve(key === "list" ? server.rows.map(t => ({ ...t })) : true);
        }
      })
    );
  const land = (key: string) =>
    out
      .splice(
        out.findIndex(f => f.key === key),
        1
      )[0]
      .go();
  return { server, out, call, land };
}

type Todo = { id: number; done: boolean };

for (const withCount of [true, false])
  it(`#4643: toggle, toggle, remove, add, add: the toggle's save lands and settles (count=${withCount})`, async () => {
    const { server, out, call, land } = fakeServer<Todo>([
      { id: 1, done: false },
      { id: 2, done: false }
    ]);
    let toggle!: (id: number) => Promise<unknown>,
      remove!: (id: number) => Promise<unknown>,
      add!: (id: number) => Promise<unknown>;
    let list = "",
      count = "";
    createRoot(() => {
      const [todos, setTodos] = createOptimisticStore<Todo[]>(() => call("list"), []);
      const remaining = createMemo(() => todos.filter(t => !t.done).length);
      toggle = action(function* (id: number) {
        setTodos(s => {
          const t = s.find(x => x.id === id);
          if (t) t.done = !t.done;
        });
        yield call("toggle:" + id, () => {
          server.rows = server.rows.map(t => (t.id === id ? { ...t, done: !t.done } : t));
        });
        refresh(todos);
      });
      remove = action(function* (id: number) {
        setTodos(s => s.filter(x => x.id !== id));
        yield call("remove:" + id, () => {
          server.rows = server.rows.filter(t => t.id !== id);
        });
        refresh(todos);
      });
      add = action(function* (id: number) {
        setTodos(s => {
          s.push({ id, done: false });
        });
        yield call("add:" + id, () => {
          server.rows = [...server.rows, { id, done: false }];
        });
        refresh(todos);
      });
      const rows = mapArray(
        () => todos,
        (t: Todo) => t
      );
      createRenderEffect(
        () =>
          rows()
            .map(t => `[${t.id}${t.done ? "x" : "o"}]`)
            .join(""),
        v => void (list = v)
      );
      if (withCount)
        createRenderEffect(
          () => remaining(),
          v => void (count = ` ${v} left`)
        );
    });
    const frames: string[] = [];
    const step = async (name: string, fn: () => void) => {
      fn();
      flush();
      await tick();
      frames.push(`${name}=${list}${count}`);
    };
    await tick();
    await step("list", () => land("list"));
    await step("t1", () => void toggle(1));
    await step("t2", () => void toggle(2));
    await step("rm2", () => void remove(2));
    await step("add3", () => void add(3));
    await step("land rm2", () => land("remove:2"));
    await step("add4", () => void add(4));
    await step("land list", () => land("list"));
    // Looped here: Potential Infinite Loop Detected.
    await step("land t1", () => land("toggle:1"));
    while (out.length) {
      const k = out[0].key;
      await step(`land ${k}`, () => land(k));
    }
    const c = (n: number) => (withCount ? ` ${n} left` : "");
    expect(frames).toEqual([
      `list=[1o][2o]${c(2)}`,
      `t1=[1x][2o]${c(1)}`,
      `t2=[1x][2x]${c(0)}`,
      `rm2=[1x]${c(0)}`,
      `add3=[1x][3o]${c(1)}`,
      `land rm2=[1x][3o]${c(1)}`,
      `add4=[1x][3o][4o]${c(2)}`,
      `land list=[1x][3o][4o]${c(2)}`,
      `land t1=[1x][3o][4o]${c(2)}`,
      `land toggle:2=[1x][3o][4o]${c(2)}`,
      `land add:3=[1x][3o][4o]${c(2)}`,
      `land add:4=[1x][3o][4o]${c(2)}`,
      `land list=[1x][3o][4o]${c(2)}`,
      `land list=[1x][3o][4o]${c(2)}`,
      `land list=[1x][3o][4o]${c(2)}`,
      `land list=[1x][3o][4o]${c(2)}`
    ]);
    expect(server.rows).toEqual([
      { id: 1, done: true },
      { id: 3, done: false },
      { id: 4, done: false }
    ]);
  });

type Mail = { id: number; read: boolean };

for (const withMemo of [true, false])
  it(`#4643: an inbox filter over a polled list with optimistic deletes settles (memo=${withMemo})`, async () => {
    const { server, out, call, land } = fakeServer<Mail>([
      { id: 1, read: true },
      { id: 2, read: false },
      { id: 3, read: true },
      { id: 4, read: false }
    ]);
    let del!: (id: number) => Promise<unknown>, poll!: () => void;
    let setFilter!: (f: "all" | "read") => void;
    let screen = "";
    createRoot(() => {
      const [filter, sf] = createSignal<"all" | "read">("all");
      setFilter = sf;
      const [inbox, set] = createOptimisticStore<Mail[]>(() => call("list"), [], { key: "id" });
      poll = () => refresh(inbox);
      const pick = () => inbox.filter(m => filter() === "all" || m.read);
      const visible = withMemo ? createMemo(pick) : pick;
      del = action(function* (id: number) {
        set(s => s.filter(x => x.id !== id));
        yield call("delete:" + id, () => {
          server.rows = server.rows.filter(t => t.id !== id);
        });
        refresh(inbox);
      });
      const rows = mapArray(visible, (m: Mail) => m);
      createRenderEffect(
        () =>
          `${filter()}:` +
          rows()
            .map(m => `[${m.id}]`)
            .join(""),
        v => void (screen = v)
      );
    });
    const step = async (fn: () => void) => {
      fn();
      flush();
      await tick();
    };
    await tick();
    await step(() => land("list"));
    expect(screen).toBe("all:[1][2][3][4]");
    await step(() => setFilter("read"));
    expect(screen).toBe("read:[1][3]");
    await step(() => void del(3));
    expect(screen).toBe("read:[1]");
    await step(() => land("delete:3"));
    await step(() => void del(2));
    await step(() => poll());
    await step(() => land("list"));
    await step(() => land("list"));
    // Looped here: Potential Infinite Loop Detected (last staged node: signal).
    await step(() => setFilter("all"));
    while (out.length) {
      const k = out[0].key;
      await step(() => land(k));
    }
    expect(screen).toBe("all:[1][4]");
    expect(server.rows.map(m => m.id)).toEqual([1, 4]);
  });
