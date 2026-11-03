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
 *
 * The loop's root: that memo is lane work, and its read of the frame's
 * staging (through the re-based lane, core.ts `frameRead`) joined the flush
 * into that frame's hold. D-37: lane work never makes a flush the hold's.
 * Joined, a plain write the flush carried (`setFilter("all")`) was held
 * into the hold and still revealed by the lane — then retracted at the next
 * seam (F-7, the Hold clause), and a guess written beside the held read
 * revealed that hold's staging through a linked lane ahead of it, torn
 * against the count (F-1, F-7). Read as a frame reader does (served the
 * staging, joining nothing), the write shows once and stays.
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
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
  const out: { key: string; go: (ok?: boolean) => void }[] = [];
  const call = (key: string, apply?: () => void) =>
    new Promise<any>((resolve, reject) =>
      out.push({
        key,
        go: (ok = true) => {
          if (!ok) return reject(new Error("declined " + key));
          apply?.();
          resolve(key === "list" ? server.rows.map(t => ({ ...t })) : true);
        }
      })
    );
  const decline = (key: string) =>
    out
      .splice(
        out.findIndex(f => f.key === key),
        1
      )[0]
      .go(false);
  const land = (key: string, which: "first" | "last" = "first") => {
    const keys = out.map(f => f.key);
    out.splice(which === "first" ? keys.indexOf(key) : keys.lastIndexOf(key), 1)[0].go();
  };
  return { server, out, call, land, decline };
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
    const frames: string[] = [];
    const step = async (name: string, fn: () => void) => {
      fn();
      flush();
      await tick();
      frames.push(`${name}=${screen}`);
    };
    await tick();
    await step("list", () => land("list"));
    await step("filter read", () => setFilter("read"));
    await step("del3", () => void del(3));
    await step("land del3", () => land("delete:3"));
    await step("del2", () => void del(2));
    await step("poll", () => poll());
    await step("land list", () => land("list"));
    await step("land list", () => land("list"));
    // Looped here: Potential Infinite Loop Detected (last staged node: signal).
    // Then, fixed only at the seam: `all:[1][4]`, `read:[1]` at the delete's
    // landing (the write held into the hold the filter memo's read joined),
    // `all:[1][4]` again at the refetch's.
    await step("filter all", () => setFilter("all"));
    while (out.length) {
      const k = out[0].key;
      await step(`land ${k}`, () => land(k));
    }
    // D-37: the filter is a plain write — it publishes at once over the
    // guesses and the deletes' hold stays open; nothing of it is held, so
    // nothing retracts (F-7, Hold). The refetch confirms [1][4] silently.
    expect(frames).toEqual([
      "list=all:[1][2][3][4]",
      "filter read=read:[1][3]",
      "del3=read:[1]",
      "land del3=read:[1]",
      "del2=read:[1]",
      "poll=read:[1]",
      "land list=read:[1]",
      "land list=read:[1]",
      "filter all=all:[1][4]",
      "land delete:2=all:[1][4]",
      "land list=all:[1][4]"
    ]);
    expect(server.rows.map(m => m.id)).toEqual([1, 4]);
  });

for (const withMemo of [true, false])
  for (const order of ["first", "last"] as const)
    it(`#4643: the inbox with a declined delete and a filter write settles (memo=${withMemo}, list=${order})`, async () => {
      const { server, out, call, land, decline } = fakeServer<Mail>([
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
          try {
            yield call("delete:" + id, () => {
              server.rows = server.rows.filter(t => t.id !== id);
            });
          } finally {
            refresh(inbox);
          }
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
      const frames: string[] = [];
      const step = async (name: string, fn: () => void) => {
        fn();
        flush();
        await tick();
        frames.push(`${name}=${screen}`);
      };
      await tick();
      await step("list", () => land("list"));
      await step("filter read", () => setFilter("read"));
      await step("poll", () => poll());
      await step("del1", () => void del(1).catch(() => {}));
      await step("del3", () => void del(3).catch(() => {}));
      await step("poll", () => poll());
      await step("decline del1", () => decline("delete:1"));
      await step("a list lands", () => land("list", order));
      await step("filter all", () => setFilter("all"));
      while (out.length) {
        const k = out[0].key;
        await step(`land ${k}`, () => land(k));
      }
      await step("poll", () => poll());
      while (out.length) {
        const k = out[0].key;
        await step(`land ${k}`, () => land(k));
      }
      // The two deletes wrote the same list: one hold (A15). The declined
      // delete's guess stays the screen until that hold commits, then
      // reverts with it in one frame (F-11, D-33); the filter write shows at
      // once over the guesses (D-37).
      const rest =
        order === "first"
          ? ["land delete:3=all:[2][4]", "land list=all:[2][4]"]
          : ["land list=all:[2][4]", "land delete:3=all:[2][4]"];
      expect(frames).toEqual([
        "list=all:[1][2][3][4]",
        "filter read=read:[1][3]",
        "poll=read:[1][3]",
        "del1=read:[3]",
        "del3=read:",
        "poll=read:",
        "decline del1=read:",
        "a list lands=read:",
        "filter all=all:[2][4]",
        ...rest,
        "land list=all:[2][4]",
        "land list=all:[1][2][4]",
        "poll=all:[1][2][4]",
        "land list=all:[1][2][4]"
      ]);
      expect(server.rows.map(m => m.id)).toEqual([1, 2, 4]);
    });

/** The todo list of the first shape, each action refreshing in `finally`
 * (the reviewer's fuzz probe for #4643). `twin`: a user effect over the
 * list's compute logs each value it sees that the screen does not show. */
function todoApp(twin = false) {
  const unshown: string[] = [];
  const srv = fakeServer<Todo>([
    { id: 1, done: false },
    { id: 2, done: false }
  ]);
  const { server, call } = srv;
  let list = "",
    count = "";
  const app = createRoot(() => {
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => call("list"), [], { key: "id" });
    const remaining = createMemo(() => todos.filter(t => !t.done).length);
    const wrap = (name: string, mut: (s: Todo[], id: number) => void, ap: (id: number) => void) =>
      action(function* (id: number) {
        setTodos(s => mut(s, id));
        try {
          yield call(`${name}:${id}`, () => ap(id));
        } finally {
          refresh(todos);
        }
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
    if (twin)
      createEffect(
        () =>
          rows()
            .map(t => `[${t.id}${t.done ? "x" : "o"}]`)
            .join(""),
        v => void (v !== list && unshown.push(v))
      );
    createRenderEffect(
      () => remaining(),
      v => void (count = ` ${v} left`)
    );
    return {
      poll: () => refresh(todos),
      toggle: wrap(
        "toggle",
        (s, id) => {
          const t = s.find(x => x.id === id);
          if (t) t.done = !t.done;
        },
        id => (server.rows = server.rows.map(t => (t.id === id ? { ...t, done: !t.done } : t)))
      ),
      remove: wrap(
        "remove",
        (s, id) => {
          const i = s.findIndex(x => x.id === id);
          if (i >= 0) s.splice(i, 1);
        },
        id => (server.rows = server.rows.filter(t => t.id !== id))
      ),
      add: wrap(
        "add",
        (s, id) => void s.push({ id, done: false }),
        id => (server.rows = [...server.rows, { id, done: false }])
      )
    };
  });
  const frames: string[] = [];
  const step = async (name: string, fn: () => void) => {
    fn();
    flush();
    await tick();
    frames.push(`${name}=${list}${count}`);
  };
  const drain = async () => {
    while (srv.out.length) {
      const k = srv.out[0].key;
      await step(`land ${k}`, () => srv.land(k));
    }
  };
  return { ...srv, ...app, frames, step, drain, unshown };
}

it("#4643: a toggle beside a held poll answer shows the screen's other rows, whole", async () => {
  const { server, land, poll, toggle, add, frames, step, drain } = todoApp();
  await tick();
  await step("list", () => land("list"));
  await step("t1", () => void toggle(1));
  await step("t1", () => void toggle(1));
  await step("land t1", () => land("toggle:1"));
  await step("poll", () => poll());
  await step("add3", () => void add(3));
  // The poll's answer ([1x]: the first toggle saved) corrects the second
  // toggle's guess beneath it; it is held with that toggle's action, and the
  // add's guess is re-based over it (#4525).
  await step("land poll", () => land("list", "last"));
  // Looped here on `next` (Potential Infinite Loop Detected, last staged
  // node: computed); fixed only at the seam, the toggle's lane revealed the
  // held correction ahead of its hold: `[1x][2o][3x] 2 left` (F-7), torn
  // against the count (F-1). D-37: the screen plus this guess.
  await step("t3", () => void toggle(3));
  await drain();
  expect(frames).toEqual([
    "list=[1o][2o] 2 left",
    "t1=[1x][2o] 1 left",
    "t1=[1o][2o] 2 left",
    "land t1=[1o][2o] 2 left",
    "poll=[1o][2o] 2 left",
    "add3=[1o][2o][3o] 3 left",
    "land poll=[1o][2o][3o] 3 left",
    "t3=[1o][2o][3x] 2 left",
    "land toggle:1=[1o][2o][3x] 2 left",
    "land list=[1o][2o][3x] 2 left",
    "land add:3=[1o][2o][3x] 2 left",
    "land toggle:3=[1o][2o][3x] 2 left",
    "land list=[1o][2o][3x] 2 left",
    "land list=[1o][2o][3x] 2 left",
    "land list=[1o][2o][3x] 2 left"
  ]);
  expect(server.rows).toEqual([
    { id: 1, done: false },
    { id: 2, done: false },
    { id: 3, done: true }
  ]);
});

// The same steps, with a user effect beside the list's render effect.
// D-34 ¶2: lane passes, untracked reads and the screen keep the guess until
// the commit — an effect's posture is the screen's here, so it sees what the
// screen shows. With #4658 alone it saw the held poll answer's `[1x]` once,
// beside the toggle's `[3x]`, while the screen showed `[1o][2o][3x]`; the
// writer composing on the screen (#4656, a held node shows what it showed)
// closes it.
it("#4643: a user effect beside the toggle sees only what the screen shows (D-34 ¶2)", async () => {
  const { land, poll, toggle, add, step, drain, unshown } = todoApp(true);
  await tick();
  await step("list", () => land("list"));
  await step("t1", () => void toggle(1));
  await step("t1", () => void toggle(1));
  await step("land t1", () => land("toggle:1"));
  await step("poll", () => poll());
  await step("add3", () => void add(3));
  await step("land poll", () => land("list", "last"));
  await step("t3", () => void toggle(3));
  await drain();
  expect(unshown).toEqual([]);
});

for (const shape of ["add3, rm3, add4", "poll, add3, land poll, rm1, add4"])
  it(`#4643: a push after a removal guess composes on the removal (${shape})`, async () => {
    // The fuzz seed's crash once the loop was gone (#4642's hole): the
    // writer's view wrote the removed slot's `undefined` past the source's
    // end, so the clone kept the old length and the push wrote after a hole
    // — a row `undefined` in the list's render effect. F-10: the draft is
    // the view the user saw, the guesses over it.
    const { server, land, poll, remove, add, frames, step, drain } = todoApp();
    await tick();
    await step("list", () => land("list"));
    if (shape.startsWith("poll")) {
      await step("poll", () => poll());
      await step("add3", () => void add(3));
      await step("land poll", () => land("list"));
      await step("rm1", () => void remove(1));
    } else {
      await step("add3", () => void add(3));
      await step("rm3", () => void remove(3));
    }
    await step("add4", () => void add(4));
    await drain();
    const end = shape.startsWith("poll") ? "[2o][3o][4o] 3 left" : "[1o][2o][4o] 3 left";
    expect(frames.slice(shape.startsWith("poll") ? 5 : 3)).toEqual([
      `add4=${end}`,
      ...frames.slice(shape.startsWith("poll") ? 6 : 4).map(f => f.replace(/=.*/, `=${end}`))
    ]);
    expect(frames.slice(0, shape.startsWith("poll") ? 5 : 3)).toEqual(
      shape.startsWith("poll")
        ? [
            "list=[1o][2o] 2 left",
            "poll=[1o][2o] 2 left",
            "add3=[1o][2o][3o] 3 left",
            "land poll=[1o][2o][3o] 3 left",
            "rm1=[2o][3o] 2 left"
          ]
        : ["list=[1o][2o] 2 left", "add3=[1o][2o][3o] 3 left", "rm3=[1o][2o] 2 left"]
    );
    expect(server.rows.map(t => t.id)).toEqual(shape.startsWith("poll") ? [2, 3, 4] : [1, 2, 4]);
  });
