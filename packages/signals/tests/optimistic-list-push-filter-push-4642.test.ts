import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  refresh,
  untrack
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Todo = { id: number; title: string };

// The cheatsheet's todo list: an optimistic store over `list`, with actions
// that write a guess, yield the save, then refresh the list (#4642).
function todoList() {
  let server: Todo[] = [
    { id: 1, title: "milk" },
    { id: 2, title: "eggs" }
  ];
  const out: { key: string; go: (ok: boolean) => void }[] = [];
  const call = (key: string, apply?: () => void) =>
    new Promise<any>((resolve, reject) =>
      out.push({
        key,
        go: ok => {
          if (!ok) return reject(new Error(key));
          apply?.();
          resolve(key === "list" ? server.map(t => ({ ...t })) : true);
        }
      })
    );
  const land = (key: string, ok = true) =>
    out
      .splice(
        out.findIndex(f => f.key === key),
        1
      )[0]
      .go(ok);
  let cells: { title: string }[] = [];
  let todos!: Todo[];
  let add!: (t: Todo) => Promise<unknown>;
  let remove!: (id: number) => Promise<unknown>;
  let rename!: (id: number, title: string) => Promise<unknown>;
  createRoot(() => {
    const [t, setTodos] = createOptimisticStore<Todo[]>(() => call("list"), []);
    todos = t;
    add = action(function* (todo: Todo) {
      setTodos(s => {
        s.push(todo);
      });
      try {
        yield call("add:" + todo.id, () => {
          server = [...server, todo];
        });
      } catch {}
      refresh(t);
    });
    remove = action(function* (id: number) {
      setTodos(s => s.filter(x => x.id !== id));
      try {
        yield call("remove:" + id, () => {
          server = server.filter(t => t.id !== id);
        });
      } catch {}
      refresh(t);
    });
    rename = action(function* (id: number, title: string) {
      setTodos(s => {
        const row = s.find(x => x.id === id);
        if (row) row.title = title;
      });
      try {
        yield call("rename:" + id, () => {
          server = server.map(t => (t.id === id ? { ...t, title } : t));
        });
      } catch {}
      refresh(t);
    });
    // As `<For>` does: each row writes its title from its own render effect
    // (a row whose effect never ran shows `?`).
    const rows = mapArray(
      () => todos,
      (row: Todo) => {
        const cell = { title: "?" };
        createRenderEffect(
          () => row.title,
          v => {
            cell.title = v;
          }
        );
        return cell;
      }
    );
    createRenderEffect(rows, v => {
      cells = v;
    });
  });
  const step = async (fn: () => void) => {
    fn();
    flush();
    await tick();
  };
  const drain = async () => {
    while (out.length) await step(() => land(out[0].key));
  };
  const untracked = () => untrack(() => todos.map(t => (t ? t.title : "<hole>")).join(","));
  return {
    out,
    land,
    step,
    drain,
    untracked,
    add,
    remove,
    rename,
    get shown() {
      return cells.map(c => "[" + c.title + "]").join("");
    },
    get server() {
      return server.map(t => "[" + t.title + "]").join("");
    }
  };
}

describe("#4642: an optimistic list's guesses compose on the list as it stands", () => {
  // F-11: from the flush that carries it, the guess is the value of its slot
  // for the screen and for untracked reads. The second push composes on the
  // filtered list, not on the list beneath it.
  for (const removeWhich of ["other", "just-added"] as const)
    it(`push, filter (${removeWhich}), push: the second push lands at the end`, async () => {
      const s = todoList();
      await tick();
      await s.step(() => s.land("list"));
      expect(s.shown).toBe("[milk][eggs]");
      await s.step(() => s.add({ id: 3, title: "jam" }));
      expect(s.shown).toBe("[milk][eggs][jam]");
      await s.step(() => s.remove(removeWhich === "other" ? 2 : 3));
      const afterRemove = removeWhich === "other" ? "[milk][jam]" : "[milk][eggs]";
      expect(s.shown).toBe(afterRemove);
      await s.step(() => s.add({ id: 4, title: "tea" }));
      const afterAdd = removeWhich === "other" ? "[milk][jam][tea]" : "[milk][eggs][tea]";
      expect(s.shown).toBe(afterAdd);
      expect(s.untracked()).toBe(afterAdd.slice(1, -1).split("][").join(","));
      await s.drain();
      expect(s.shown).toBe(s.server);
      expect(s.shown).toBe(afterAdd);
    });

  // An add written while the list's first load is out: at the commit rows
  // match by key (D-34 ¶2), so the settled list is the server's. When the
  // load lands first, no frame is torn: each row shows once (F-1). (Which
  // rows that frame shows — the load's answer re-based under the guess, as
  // #4525 pins for a guess written under a question in flight, or the guess
  // void because the screen never showed it — is not pinned here.)
  it("an add before the first load lands: list lands first", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.land("list"));
    const rows = s.shown.slice(1, -1).split("][");
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.every(r => ["milk", "eggs", "jam"].includes(r))).toBe(true);
    expect(s.untracked().split(",").sort()).toEqual([...rows].sort());
    await s.step(() => s.land("add:3"));
    await s.drain();
    expect(s.shown).toBe("[milk][eggs][jam]");
    expect(s.untracked()).toBe("milk,eggs,jam");
  });

  it("an add before the first load lands: save lands first", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.land("add:3"));
    await s.step(() => s.land("list"));
    await s.drain();
    expect(s.shown).toBe("[milk][eggs][jam]");
    expect(s.untracked()).toBe("milk,eggs,jam");
  });

  // D-33/D-35: the declined delete's hold reverts its own write; the add's
  // guess then settles under the truth, rows matched by key (D-34).
  for (const renameFirst of [false, true])
    it(`a declined delete, then an add, settles to the server (rename first=${renameFirst})`, async () => {
      const s = todoList();
      await tick();
      await s.step(() => s.land("list"));
      if (renameFirst) {
        await s.step(() => s.rename(1, "oat milk"));
        await s.drain();
      }
      const first = renameFirst ? "oat milk" : "milk";
      expect(s.shown).toBe(`[${first}][eggs]`);
      await s.step(() => s.remove(1));
      expect(s.shown).toBe("[eggs]");
      await s.step(() => s.land("remove:1", false));
      await s.step(() => s.add({ id: 3, title: "jam" }));
      await s.drain();
      expect(s.shown).toBe(s.server);
      expect(s.shown).toBe(`[${first}][eggs][jam]`);
      expect(s.untracked()).toBe(`${first},eggs,jam`);
    });
});
