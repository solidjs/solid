/**
 * #5136 — a guessed row must not remount when the truth lands from a local
 * source store with the same `id` (matching the fetch + `refresh()` form).
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

interface Todo {
  id: string;
  text: string;
  pending?: boolean;
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("#5136 guessed row identity when truth lands from a local source store", () => {
  test("repro: local source store keeps the guessed row proxy when saved with the same id", async () => {
    const [source, setSource] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const updates: string[] = [];
    const textOnly: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          createRenderEffect(
            () => row.text,
            v => {
              textOnly.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.push(saved);
      });
    });

    const done = add("milk");
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);
    expect(textOnly).toEqual(["milk"]);

    resolveSave({ id: "tmp-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);
    // Unchanged leaf effect did not re-fire, yet must stay live for future source writes.
    expect(textOnly).toEqual(["milk"]);

    setSource(s => {
      s[0].text = "oat milk";
    });
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false", "tmp-1:oat milk:false"]);
    expect(textOnly).toEqual(["milk", "oat milk"]);
  });

  test("local source store remounts when saved with a different id", async () => {
    const [source, setSource] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.push(saved);
      });
    });

    const done = add("milk");
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    resolveSave({ id: "srv-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1", "srv-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "srv-1:milk:false"]);
  });

  test("control: fetch + refresh keeps the guessed row proxy when saved with the same id", async () => {
    let remote: Todo[] = [];
    const [todos, setTodos] = createOptimisticStore<Todo[]>(
      async () => remote.map(t => ({ ...t })),
      []
    );

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();
    await tick();

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      remote = [...remote, saved];
      yield refresh(todos);
    });

    const done = add("milk");
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    resolveSave({ id: "tmp-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);
  });

  test("direct chained createOptimisticStore(source) keeps the guessed row proxy on same id", async () => {
    const [source, setSource] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(source);

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.push(saved);
      });
    });

    const done = add("milk");
    flush();
    await tick();
    expect(mounts).toEqual(["tmp-1"]);

    resolveSave({ id: "tmp-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);

    setSource(s => {
      s[0].text = "skim milk";
    });
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false", "tmp-1:skim milk:false"]);
  });

  test("action with a second yield after setSource holds pending on screen until settle without remounting", async () => {
    const [source, setSource] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveSave!: (t: Todo) => void;
    let resolveFinish!: () => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.push(saved);
      });
      yield new Promise<void>(r => (resolveFinish = r));
    });

    const done = add("milk");
    flush();
    await tick();
    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    resolveSave({ id: "tmp-1", text: "milk" });
    flush();
    await tick();

    // Still held on second yield: screen keeps the guess with pending: true.
    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    resolveFinish();
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);
  });

  test("reverts cleanly when action rejects without writing to source", async () => {
    const [source] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const lengths: number[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        len => {
          lengths.push(len);
        }
      );
    });
    flush();

    let rejectSave!: (e: Error) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      yield new Promise<Todo>((_, r) => (rejectSave = r));
    });

    const done = add("milk").catch(() => "failed");
    flush();
    await tick();
    expect(mounts).toEqual(["tmp-1"]);
    expect(lengths).toEqual([0, 1]);

    rejectSave(new Error("boom"));
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(lengths).toEqual([0, 1, 0]);
  });

  test("keeps both existing and guessed rows when truth inserts at a different index", async () => {
    const [source, setSource] = createStore<Todo[]>([{ id: "a", text: "A" }]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const order: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          return row;
        }
      );
      createRenderEffect(
        () =>
          rows()
            .map(r => `${r.id}:${!!r.pending}`)
            .join(","),
        v => {
          order.push(v);
        }
      );
    });
    flush();
    expect(mounts).toEqual(["a"]);
    expect(order).toEqual(["a:false"]);

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.unshift(saved);
      });
    });

    const done = add("milk");
    flush();
    await tick();
    expect(mounts).toEqual(["a", "tmp-1"]);
    expect(order).toEqual(["a:false", "a:false,tmp-1:true"]);

    resolveSave({ id: "tmp-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["a", "tmp-1"]);
    expect(order).toEqual(["a:false", "a:false,tmp-1:true", "tmp-1:false,a:false"]);
  });

  test("custom key option pairs by that key; key: null remounts", async () => {
    type Item = { uid: string; text: string; pending?: boolean };
    const [source1, setSource1] = createStore<Item[]>([]);
    const [items1, setItems1] = createOptimisticStore<Item[]>(() => source1, [], { key: "uid" });
    const mounts1: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => items1,
        row => {
          mounts1.push(row.uid);
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolve1!: (x: Item) => void;
    const add1 = action(function* () {
      setItems1(d => {
        d.push({ uid: "u-1", text: "milk", pending: true });
      });
      const saved: Item = yield new Promise<Item>(r => (resolve1 = r));
      setSource1(s => {
        s.push(saved);
      });
    });

    const p1 = add1();
    flush();
    await tick();
    resolve1({ uid: "u-1", text: "milk" });
    await p1;
    flush();
    await tick();
    expect(mounts1).toEqual(["u-1"]);

    // Unkeyed (key: null): does not pair by id, remounts.
    const [source2, setSource2] = createStore<Todo[]>([]);
    const [items2, setItems2] = createOptimisticStore<Todo[]>(() => source2, [], { key: null });
    const mounts2: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => items2,
        row => {
          mounts2.push(row.id);
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolve2!: (x: Todo) => void;
    const add2 = action(function* () {
      setItems2(d => {
        d.push({ id: "tmp-1", text: "milk", pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolve2 = r));
      setSource2(s => {
        s.push(saved);
      });
    });

    const p2 = add2();
    flush();
    await tick();
    resolve2({ id: "tmp-1", text: "milk" });
    await p2;
    flush();
    await tick();
    expect(mounts2).toEqual(["tmp-1", "tmp-1"]);
  });

  test("nested chained array keeps guessed row proxy on same id", async () => {
    const [source, setSource] = createStore<{ items: Todo[] }>({ items: [] });
    const [view, setView] = createOptimisticStore<{ items: Todo[] }>(() => source, { items: [] });

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => view.items,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveSave!: (t: Todo) => void;
    const add = action(function* (text: string) {
      setView(v => {
        v.items.push({ id: "tmp-1", text, pending: true });
      });
      const saved: Todo = yield new Promise<Todo>(r => (resolveSave = r));
      setSource(s => {
        s.items.push(saved);
      });
    });

    const done = add("milk");
    flush();
    await tick();

    resolveSave({ id: "tmp-1", text: "milk" });
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);
  });

  test("external source update before action settles carries over without remounting", async () => {
    const [source, setSource] = createStore<Todo[]>([]);
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => source, []);

    const mounts: string[] = [];
    const updates: string[] = [];

    createRoot(() => {
      const rows = mapArray(
        () => todos,
        row => {
          mounts.push(row.id);
          createRenderEffect(
            () => `${row.id}:${row.text}:${!!row.pending}`,
            v => {
              updates.push(v);
            }
          );
          return row;
        }
      );
      createRenderEffect(
        () => rows().length,
        () => {}
      );
    });
    flush();

    let resolveAction!: () => void;
    const add = action(function* (text: string) {
      setTodos(t => {
        t.push({ id: "tmp-1", text, pending: true });
      });
      yield new Promise<void>(r => (resolveAction = r));
    });

    const done = add("milk");
    flush();
    await tick();
    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    // Truth arrives in source before action settles (e.g. external sync).
    setSource(s => {
      s.push({ id: "tmp-1", text: "milk" });
    });
    flush();
    await tick();
    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true"]);

    resolveAction();
    await done;
    flush();
    await tick();

    expect(mounts).toEqual(["tmp-1"]);
    expect(updates).toEqual(["tmp-1:milk:true", "tmp-1:milk:false"]);
  });
});
