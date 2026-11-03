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
function todoList(key?: "id" | null) {
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
  let cells: { title: string; id: unknown }[] = [];
  const errors: unknown[] = [];
  let todos!: Todo[];
  let add!: (t: Todo) => Promise<unknown>;
  let remove!: (id: number) => Promise<unknown>;
  let rename!: (id: number, title: string) => Promise<unknown>;
  createRoot(() => {
    const [t, setTodos] = createOptimisticStore<Todo[]>(
      () => call("list"),
      [],
      key === undefined ? undefined : { key }
    );
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
        const cell = { title: "?", id: undefined as unknown };
        if (row === undefined) errors.push("undefined row");
        createRenderEffect(
          () => row?.title,
          v => {
            cell.title = v!;
          }
        );
        createRenderEffect(
          () => row?.id,
          v => {
            cell.id = v;
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
    try {
      fn();
      flush();
    } catch (e) {
      errors.push(e);
    }
    await tick();
  };
  const drain = async () => {
    while (out.length) await step(() => land(out[0].key));
  };
  const untracked = () => untrack(() => todos.map(t => (t ? t.title : "<hole>")).join(","));
  const loaded = () => {
    try {
      untrack(() => todos.length);
      return true;
    } catch {
      return false;
    }
  };
  return {
    out,
    land,
    step,
    drain,
    untracked,
    errors,
    loaded,
    refreshList: () => refresh(todos as any),
    add: (t: Todo) => add(t).catch(e => errors.push(e)),
    remove: (id: number) => remove(id).catch(e => errors.push(e)),
    rename: (id: number, title: string) => rename(id, title).catch(e => errors.push(e)),
    rawAdd: (t: Todo) => add(t),
    get cells() {
      return cells;
    },
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

  // An add written while the list's first load is out: before its first
  // answer the list is loading, not a value to be optimistic over (ruled
  // 2026-11-03, #4656). In DEV the write throws OPTIMISTIC_WRITE_BEFORE_LOAD
  // and the action rejects; nothing is guessed, so the first load shows as
  // it lands and the add works once the list has loaded.
  it("an add before the first load lands: OPTIMISTIC_WRITE_BEFORE_LOAD", async () => {
    const s = todoList();
    await tick();
    let error: unknown;
    await s.step(() => {
      s.rawAdd({ id: 3, title: "jam" }).catch(e => (error = e));
    });
    expect(String(error)).toMatch(/OPTIMISTIC_WRITE_BEFORE_LOAD/);
    expect(s.out.map(o => o.key)).toEqual(["list"]);
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("[milk][eggs]");
    expect(s.untracked()).toBe("milk,eggs");
    await s.step(() => s.add({ id: 3, title: "jam" }));
    expect(s.shown).toBe("[milk][eggs][jam]");
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

  // F-11: each guess shows from the flush that carries it, also while an
  // earlier action's refresh is out. That refresh re-asks the earlier
  // guess's own question (D-34 ¶3): it holds that action, not the lanes the
  // new guesses compose in. Its answer is older than the new guesses and
  // re-bases them by row key (D-35); the row the delete removed stays
  // removed beside it — that delete's own landing judges it (D-33). Every
  // row shows its content (F-1).
  it("add, its save lands, delete, add: each guess shows at once (F-11, D-35)", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.land("add:3"));
    await s.step(() => s.remove(1));
    expect(s.shown).toBe("[eggs][jam]");
    await s.step(() => s.add({ id: 4, title: "tea" }));
    expect(s.shown).toBe("[eggs][jam][tea]");
    expect(s.untracked()).toBe("eggs,jam,tea");
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("[eggs][jam][tea]");
    expect(s.untracked()).toBe("eggs,jam,tea");
    await s.step(() => s.add({ id: 5, title: "oats" }));
    expect(s.shown).toBe("[eggs][jam][tea][oats]");
    await s.drain();
    expect(s.shown).toBe("[eggs][jam][tea][oats]");
    expect(s.shown).toBe(s.server);
    expect(s.errors).toEqual([]);
  });

  // F-11: a later add while the delete's refresh is out shows at once.
  it("add, delete, the delete's save lands, add, add: each guess shows at once", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.remove(2));
    await s.step(() => s.land("remove:2"));
    await s.step(() => s.add({ id: 4, title: "tea" }));
    expect(s.shown).toBe("[milk][jam][tea]");
    await s.step(() => s.add({ id: 5, title: "oats" }));
    expect(s.shown).toBe("[milk][jam][tea][oats]");
    await s.drain();
    expect(s.shown).toBe("[milk][jam][tea][oats]");
    expect(s.shown).toBe(s.server);
    expect(s.errors).toEqual([]);
  });

  // D-35: a refresh asked between two deletes lands older than the second:
  // both guesses stay in force over it (screen and untracked reads alike),
  // and a later rename of a removed row finds no row to write.
  it("delete, refresh, delete, the refresh lands: both deletes stay (D-35)", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.remove(1));
    await s.step(() => s.refreshList());
    await s.step(() => s.remove(2));
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("");
    expect(s.untracked()).toBe("");
    await s.step(() => s.rename(1, "oat milk"));
    await s.drain();
    expect(s.shown).toBe(s.server);
    expect(s.errors).toEqual([]);
  });

  // A guess written while a `refresh()` is out composes over the same
  // question (D-34 ¶3: a refresh asks nothing new), so that refresh's
  // answer, older than the guess, re-bases it by row key (D-35) and every
  // later guess shows at once with its content (F-11, F-1).
  it("delete lands, delete while its refresh is out, refresh lands, three adds", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.remove(1));
    await s.step(() => s.land("remove:1"));
    await s.step(() => s.remove(2));
    expect(s.shown).toBe("");
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("");
    expect(s.untracked()).toBe("");
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.add({ id: 4, title: "tea" }));
    await s.step(() => s.add({ id: 5, title: "oats" }));
    expect(s.shown).toBe("[jam][tea][oats]");
    expect(s.untracked()).toBe("jam,tea,oats");
    await s.drain();
    expect(s.shown).toBe("[jam][tea][oats]");
    expect(s.shown).toBe(s.server);
    expect(s.errors).toEqual([]);
  });

  // `key: null`: a correction keeps what the screen showed until the
  // commit (D-34), and a guess written meanwhile composes on that screen
  // (D-37), never on the truth beneath it beside the screen's length.
  it("key: null — delete, refresh lands, add: the add composes on the screen", async () => {
    const s = todoList(null);
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.remove(1));
    await s.step(() => s.refreshList());
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("[eggs]");
    await s.step(() => s.add({ id: 3, title: "jam" }));
    expect(s.shown).toBe("[eggs][jam]");
    expect(s.untracked()).toBe("eggs,jam");
    await s.drain();
    expect(s.shown).toBe(s.server);
    expect(s.errors).toEqual([]);
  });

  // Random sequences of add / delete / rename / refresh and landings (some
  // declined), keyed and `key: null`: no row shows twice or empty, nothing
  // throws, and the list settles to the server's, screen and untracked
  // reads alike. No guess before the first load (OPTIMISTIC_WRITE_BEFORE_LOAD).
  for (const key of ["id", null] as const)
    it(`random sequences settle to the server (key: ${key})`, async () => {
      const fails: string[] = [];
      for (let seed = 1; seed <= 100; seed++) {
        let x = seed;
        const r = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x / 0x7fffffff);
        const s = todoList(key);
        const log: string[] = [];
        let nextId = 3;
        let bad = "";
        await tick();
        let loaded = r() >= 0.3;
        if (loaded) await s.step(() => s.land("list"));
        for (let k = 0; k < 8 && !bad; k++) {
          const p = r();
          const ids = s.cells.map(c => c.id as number).filter(i => i !== undefined);
          if (!loaded && p < 0.55) continue;
          if (p < 0.3) {
            const id = nextId++;
            log.push("add " + id);
            await s.step(() => s.add({ id, title: "t" + id }));
          } else if (p < 0.45 && ids.length) {
            const id = ids[Math.floor(r() * ids.length)];
            log.push("remove " + id);
            await s.step(() => s.remove(id));
          } else if (p < 0.55 && ids.length) {
            const id = ids[Math.floor(r() * ids.length)];
            log.push("rename " + id);
            await s.step(() => s.rename(id, "r" + id + "_" + k));
          } else if (p < 0.6) {
            log.push("refresh");
            await s.step(() => s.refreshList());
          } else if (s.out.length) {
            const f = s.out[Math.floor(r() * s.out.length)].key;
            const ok = f === "list" || r() < 0.75;
            log.push("land " + f + (ok ? "" : " NO"));
            await s.step(() => s.land(f, ok));
            if (f === "list") loaded = s.loaded();
          }
          const shownIds = s.cells.map(c => c.id);
          if (s.errors.length) bad = "error " + s.errors.map(String);
          else if (new Set(shownIds).size !== shownIds.length)
            bad = "duplicate or empty " + s.shown;
        }
        if (!bad) {
          await s.drain();
          if (s.errors.length) bad = "error " + s.errors.map(String);
          else if (s.shown !== s.server) bad = `settled ${s.shown} != ${s.server}`;
          else if ("[" + s.untracked().split(",").join("][") + "]" !== (s.server || "[]"))
            bad = "untracked " + s.untracked();
        }
        if (bad) fails.push(`seed ${seed}: ${bad} :: ${log.join(", ")}`);
      }
      expect(fails).toEqual([]);
    }, 60000);
});
